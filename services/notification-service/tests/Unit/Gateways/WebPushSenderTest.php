<?php

use Bandada\Notification\Entities\DevicePlatform;
use Bandada\Notification\Entities\DeviceToken;
use Bandada\Notification\Entities\WebPushSubscription;
use Bandada\Notification\InterfaceAdapters\Gateways\WebPush\PlatformRoutingPushSender;
use Bandada\Notification\InterfaceAdapters\Gateways\WebPush\WebPushSender;
use Bandada\Notification\UseCases\Ports\RenderedMessage;
use Minishlink\WebPush\VAPID;
use Tests\Support\FakePushSender;
use Tests\Support\FakePushService;

/** A real P-256 browser keypair so that the library can encrypt the payload (aes128gcm). */
function browserSubscription(string $endpoint): WebPushSubscription
{
    $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    $ec = openssl_pkey_get_details($key)['ec'];
    $b64 = static fn (string $b): string => rtrim(strtr(base64_encode($b), '+/', '-_'), '=');

    return new WebPushSubscription($endpoint, $b64("\x04".str_pad($ec['x'], 32, "\0", STR_PAD_LEFT).str_pad($ec['y'], 32, "\0", STR_PAD_LEFT)), $b64(random_bytes(16)));
}

function webDevice(string $token, ?WebPushSubscription $sub, DevicePlatform $platform = DevicePlatform::Web): DeviceToken
{
    $now = new DateTimeImmutable('2026-10-15T12:00:00Z');

    return new DeviceToken($token, 'u1', $platform, null, null, $now, $now, $sub);
}

beforeEach(function () {
    $this->vapid = VAPID::createVapidKeys();
    $this->message = new RenderedMessage('Hola', 'Cuerpo');
});

it('sends an encrypted, VAPID-signed Web Push to each WEB subscription and reports delivery', function () {
    $service = new FakePushService;
    $sender = new WebPushSender('mailto:ops@bandada.localhost', $this->vapid['publicKey'], $this->vapid['privateKey'], 600, $service);

    $result = $sender->send([
        webDevice('d1', browserSubscription('https://push.example/a')),
        webDevice('d2', browserSubscription('https://push.example/b')),
        webDevice('ios', null, DevicePlatform::Ios),
        webDevice('web-without-subscription', null),
    ], $this->message, ['type' => 'NEW_COMMENT']);

    expect($result->delivered)->toBeTrue()->and($result->invalidTokens)->toBe([])->and($service->requests)->toHaveCount(2);
    $request = $service->requests[0];
    expect($request->getHeaderLine('Content-Encoding'))->toBe('aes128gcm')
        ->and($request->getHeaderLine('TTL'))->toBe('600')
        ->and($request->getHeaderLine('Authorization'))->toStartWith('vapid t=')->and($request->getHeaderLine('Authorization'))->toContain('k='.$this->vapid['publicKey'])
        ->and((string) $request->getBody())->not->toContain('Hola'); // encrypted
});

it('reports expired subscriptions (404/410) as invalid tokens and keeps the valid ones', function () {
    $service = new FakePushService(['https://push.example/gone' => 410, 'https://push.example/missing' => 404, 'https://push.example/ok' => 201]);
    $sender = new WebPushSender('mailto:ops@bandada.localhost', $this->vapid['publicKey'], $this->vapid['privateKey'], 600, $service);

    $result = $sender->send([
        webDevice('gone', browserSubscription('https://push.example/gone')),
        webDevice('missing', browserSubscription('https://push.example/missing')),
        webDevice('ok', browserSubscription('https://push.example/ok')),
    ], $this->message, []);

    expect($result->delivered)->toBeTrue()->and($result->invalidTokens)->toEqualCanonicalizing(['gone', 'missing']);
});

it('does not mark delivery when every subscription is gone, nor on server errors (no deletion)', function () {
    $service = new FakePushService(['https://push.example/gone' => 410, 'https://push.example/boom' => 500]);
    $sender = new WebPushSender('mailto:ops@bandada.localhost', $this->vapid['publicKey'], $this->vapid['privateKey'], 600, $service);

    $result = $sender->send([
        webDevice('gone', browserSubscription('https://push.example/gone')),
        webDevice('boom', browserSubscription('https://push.example/boom')),
    ], $this->message, []);

    expect($result->delivered)->toBeFalse()->and($result->invalidTokens)->toBe(['gone']);
});

it('routes IOS/ANDROID to the mobile provider and WEB to Web Push', function () {
    $mobile = new FakePushSender;
    $service = new FakePushService;
    $router = new PlatformRoutingPushSender($mobile, new WebPushSender('mailto:ops@bandada.localhost', $this->vapid['publicKey'], $this->vapid['privateKey'], 600, $service));

    $result = $router->send([
        webDevice('ExponentPushToken[x]', null, DevicePlatform::Android),
        webDevice('w1', browserSubscription('https://push.example/a')),
    ], $this->message, ['type' => 'X']);

    expect($result->delivered)->toBeTrue()->and($mobile->sent)->toHaveCount(1)->and($mobile->sent[0]['tokens'])->toBe(['ExponentPushToken[x]'])->and($service->requests)->toHaveCount(1);
});

it('skips WEB devices when VAPID is not configured, and throws only if nothing could be attempted successfully', function () {
    $mobile = new FakePushSender;
    $router = new PlatformRoutingPushSender($mobile, null);
    expect($router->send([webDevice('w1', browserSubscription('https://push.example/a'))], $this->message, [])->delivered)->toBeFalse()->and($mobile->sent)->toBe([]);

    $mobile->fails = true;
    expect(fn () => $router->send([webDevice('a', null, DevicePlatform::Android)], $this->message, []))->toThrow(RuntimeException::class);
});
