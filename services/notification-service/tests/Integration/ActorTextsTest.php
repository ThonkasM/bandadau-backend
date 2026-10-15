<?php

use Bandada\Notification\Entities\Locale;
use Bandada\Notification\Entities\NotificationType;
use Bandada\Notification\InterfaceAdapters\Gateways\Templates\IcuTemplateRenderer;

it('renders the actor name in both locales and keeps the generic text without it', function () {
    $renderer = new IcuTemplateRenderer;
    $named = ['actorName' => "Lucía O'Brien {x}", 'hasActor' => 'yes'];

    expect($renderer->render(NotificationType::NewComment, $named, Locale::Es)->body)->toBe("Lucía O'Brien {x} comentó tu publicación.")
        ->and($renderer->render(NotificationType::NewReaction, $named, Locale::En)->body)->toBe("Lucía O'Brien {x} reacted to your post.")
        ->and($renderer->render(NotificationType::NewFollower, $named, Locale::Es)->body)->toBe("Lucía O'Brien {x} empezó a seguirte.")
        ->and($renderer->render(NotificationType::NewComment, [], Locale::Es)->body)->toBe('Alguien comentó tu publicación.')
        ->and($renderer->render(NotificationType::NewFollower, [], Locale::En)->body)->toBe('You have a new follower.');
});
