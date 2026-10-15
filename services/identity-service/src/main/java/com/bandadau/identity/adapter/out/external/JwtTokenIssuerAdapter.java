package com.bandadau.identity.adapter.out.external;

import com.bandadau.identity.application.port.out.*;
import com.bandadau.identity.domain.model.Role;
import com.bandadau.identity.domain.model.SigningKey;
import com.bandadau.identity.domain.model.SigningKey.Status;
import com.bandadau.identity.domain.model.TargetApp;
import com.bandadau.identity.domain.model.User;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.*;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * RS256 issuer backed by the {@code signing_keys} table (seguridad-y-sso.md section 2.2).
 * Keys are generated on first start and stored encrypted with a KEK; the lifecycle is
 * PENDING -> ACTIVE -> RETIRING -> RETIRED.
 */
public class JwtTokenIssuerAdapter implements TokenIssuerPort {
    private static final Logger log = LoggerFactory.getLogger(JwtTokenIssuerAdapter.class);
    private static final Duration CACHE_TTL = Duration.ofSeconds(30);
    private static final DateTimeFormatterHolder KID = new DateTimeFormatterHolder();

    public record Settings(String issuer, String kek, String keyId, String privateKeyPath, Duration rotationInterval,
                           Duration activationDelay, Duration retiringGrace) { }

    private record LoadedKey(SigningKey meta, RSAKey jwk) { }

    private record Snapshot(List<LoadedKey> keys, Instant loadedAt) { }

    private final SigningKeyRepositoryPort repository;
    private final TransactionPort tx;
    private final ClockPort clock;
    private final IdGeneratorPort ids;
    private final Settings settings;
    private final SecureRandom random = new SecureRandom();
    private volatile Snapshot snapshot;

    public JwtTokenIssuerAdapter(SigningKeyRepositoryPort repository, TransactionPort tx, ClockPort clock,
                                 IdGeneratorPort ids, Settings settings) {
        this.repository = repository;
        this.tx = tx;
        this.clock = clock;
        this.ids = ids;
        this.settings = settings;
    }

    /** Called once at startup: makes sure an ACTIVE key exists. */
    public void initialize() {
        try {
            tx.inTransaction(() -> {
                List<SigningKey> all = repository.findAll();
                if (all.stream().noneMatch(k -> k.status() == Status.ACTIVE)) {
                    Optional<SigningKey> pending = all.stream().filter(k -> k.status() == Status.PENDING).findFirst();
                    if (pending.isPresent()) {
                        repository.update(pending.get().withStatus(Status.ACTIVE, clock.now()));
                    } else {
                        repository.insert(newKey(Status.ACTIVE, loadImportedKey()));
                        log.info("event=jwt.key.created status=ACTIVE");
                    }
                }
            });
        } catch (RuntimeException e) {
            // Another replica won the race on ux_one_active_key: just reload.
            log.info("event=jwt.key.init.race error={}", e.getClass().getSimpleName());
        }
        reload();
    }

    /** Daily evaluation of the rotation state machine. */
    @Scheduled(cron = "${bandada.jwt.rotation-cron:0 17 3 * * *}")
    public void evaluateRotation() {
        try {
            tx.inTransaction(() -> evaluate(clock.now()));
        } catch (RuntimeException e) {
            log.warn("event=jwt.key.rotation.failed error={}", e.toString());
        }
        reload();
    }

    /** Package-visible for tests and for an operator-triggered rotation. */
    public void evaluate(Instant now) {
        List<SigningKey> all = repository.findAll();
        Optional<SigningKey> active = all.stream().filter(k -> k.status() == Status.ACTIVE).findFirst();
        Optional<SigningKey> pending = all.stream().filter(k -> k.status() == Status.PENDING).findFirst();
        if (pending.isPresent() && active.isPresent()
                && !pending.get().createdAt().plus(settings.activationDelay()).isAfter(now)) {
            repository.update(active.get().withStatus(Status.RETIRING, now));
            repository.update(pending.get().withStatus(Status.ACTIVE, now));
            log.info("event=jwt.key.activated kid={}", pending.get().kid());
        } else if (pending.isEmpty() && active.isPresent()
                && !active.get().activatedAt().plus(settings.rotationInterval()).isAfter(now)) {
            repository.insert(newKey(Status.PENDING, null));
            log.info("event=jwt.key.created status=PENDING");
        }
        for (SigningKey k : all) {
            if (k.status() == Status.RETIRING && k.retiredAt() != null
                    && !k.retiredAt().plus(settings.retiringGrace()).isAfter(now)) {
                repository.update(k.withStatus(Status.RETIRED, now));
            }
        }
        snapshot = null;
    }

    public JWKSet publicKeySet() {
        return new JWKSet(current().keys().stream().filter(k -> k.meta().status() != Status.RETIRED)
                .map(k -> (com.nimbusds.jose.jwk.JWK) k.jwk().toPublicJWK()).toList());
    }

    private Snapshot current() {
        Snapshot s = snapshot;
        if (s == null || s.loadedAt().plus(CACHE_TTL).isBefore(clock.now())) {
            reload();
            s = snapshot;
        }
        return s;
    }

    private void reload() {
        List<LoadedKey> loaded = new ArrayList<>();
        for (SigningKey key : repository.findAll()) {
            if (key.status() == Status.RETIRED) continue;
            loaded.add(new LoadedKey(key, toJwk(key)));
        }
        snapshot = new Snapshot(loaded, clock.now());
    }

    private LoadedKey active() {
        return current().keys().stream().filter(k -> k.meta().status() == Status.ACTIVE).findFirst()
                .orElseThrow(() -> new IllegalStateException("No ACTIVE signing key"));
    }

    @Override
    public String issueAccess(User user, TargetApp audience, Duration ttl) {
        Instant now = clock.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(settings.issuer())
                .subject(user.id().toString())
                .audience(audience == TargetApp.ADMIN ? "bandada-admin" : "bandada-app")
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plus(ttl)))
                .jwtID(ids.newId().toString())
                .claim("typ", "user")
                .claim("roles", user.roles().stream().map(Role::name).sorted().toList())
                .claim("uni", user.universityId().toString())
                .claim("locale", user.language().code())
                .claim("scope", "")
                .build();
        return sign(claims);
    }

    @Override
    public String issueService(String clientId, Set<String> scopes, Duration ttl) {
        Instant now = clock.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(settings.issuer())
                .subject(clientId)
                .audience("bandada-internal")
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plus(ttl)))
                .jwtID(ids.newId().toString())
                .claim("typ", "service")
                .claim("client_id", clientId)
                .claim("scope", String.join(" ", scopes))
                .build();
        return sign(claims);
    }

    @Override
    public List<Map<String, Object>> publicKeys() {
        return publicKeySet().getKeys().stream().map(k -> k.toJSONObject()).toList();
    }

    private String sign(JWTClaimsSet claims) {
        LoadedKey key = active();
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.meta().kid())
                    .type(com.nimbusds.jose.JOSEObjectType.JWT).build(), claims);
            jwt.sign(new RSASSASigner(key.jwk()));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException("Cannot sign JWT", e);
        }
    }

    private KeyPair loadImportedKey() {
        String path = settings.privateKeyPath();
        if (path == null || path.isBlank() || !Files.isRegularFile(Path.of(path))) return null;
        try {
            String pem = Files.readString(Path.of(path), StandardCharsets.US_ASCII)
                    .replaceAll("-----[A-Z ]+-----", "").replaceAll("\\s", "");
            KeyFactory factory = KeyFactory.getInstance("RSA");
            RSAPrivateKey priv = (RSAPrivateKey) factory.generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem)));
            RSAPublicKey pub = (RSAPublicKey) factory.generatePublic(new java.security.spec.RSAPublicKeySpec(
                    priv.getModulus(), java.math.BigInteger.valueOf(65537)));
            log.info("event=jwt.key.imported path={}", path);
            return new KeyPair(pub, priv);
        } catch (Exception e) {
            throw new IllegalStateException("Cannot import JWT private key from " + path, e);
        }
    }

    /** Best effort: leaves the first generated key as a PKCS#8 PEM at JWT_PRIVATE_KEY_PATH (e.g. a mounted secrets dir). */
    private void exportGenerated(KeyPair pair) {
        String path = settings.privateKeyPath();
        if (path == null || path.isBlank() || Files.exists(Path.of(path))) return;
        try {
            String body = Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.US_ASCII)).encodeToString(pair.getPrivate().getEncoded());
            Files.writeString(Path.of(path), "-----BEGIN PRIVATE KEY-----\n" + body + "\n-----END PRIVATE KEY-----\n");
            log.info("event=jwt.key.exported path={}", path);
        } catch (Exception e) {
            log.warn("event=jwt.key.export.failed path={} error={}", path, e.getClass().getSimpleName());
        }
    }

    private SigningKey newKey(Status status, KeyPair imported) {
        try {
            KeyPair pair = imported;
            if (pair == null) {
                KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
                generator.initialize(2048);
                pair = generator.generateKeyPair();
            }
            if (imported == null && status == Status.ACTIVE) exportGenerated(pair);
            Instant now = clock.now();
            String kid = imported != null && settings.keyId() != null && !settings.keyId().isBlank()
                    ? settings.keyId() : KID.format(now) + "-" + Integer.toHexString(random.nextInt(0x1000, 0xFFFF));
            RSAKey publicJwk = new RSAKey.Builder((RSAPublicKey) pair.getPublic()).keyID(kid).keyUse(KeyUse.SIGNATURE)
                    .algorithm(JWSAlgorithm.RS256).build();
            return new SigningKey(kid, publicJwk.toJSONString(), encrypt(pair.getPrivate().getEncoded()), status, now,
                    status == Status.ACTIVE ? now : null, null);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Cannot create signing key", e);
        }
    }

    private RSAKey toJwk(SigningKey key) {
        try {
            RSAKey publicJwk = RSAKey.parse(key.publicJwk());
            PrivateKey priv = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(decrypt(key.privateKeyEnc())));
            return new RSAKey.Builder(publicJwk).privateKey(priv).build();
        } catch (Exception e) {
            throw new IllegalStateException("Cannot load signing key " + key.kid(), e);
        }
    }

    private SecretKeySpec kek() throws NoSuchAlgorithmException {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(settings.kek().getBytes(StandardCharsets.UTF_8));
        return new SecretKeySpec(digest, "AES");
    }

    private byte[] encrypt(byte[] plain) throws GeneralSecurityException {
        byte[] nonce = new byte[12];
        random.nextBytes(nonce);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, kek(), new GCMParameterSpec(128, nonce));
        byte[] encrypted = cipher.doFinal(plain);
        byte[] out = new byte[nonce.length + encrypted.length];
        System.arraycopy(nonce, 0, out, 0, nonce.length);
        System.arraycopy(encrypted, 0, out, nonce.length, encrypted.length);
        return out;
    }

    private byte[] decrypt(byte[] data) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, kek(), new GCMParameterSpec(128, data, 0, 12));
        return cipher.doFinal(data, 12, data.length - 12);
    }

    private static final class DateTimeFormatterHolder {
        private final java.time.format.DateTimeFormatter formatter = java.time.format.DateTimeFormatter
                .ofPattern("yyyy-MM-dd").withZone(java.time.ZoneOffset.UTC);

        String format(Instant instant) { return formatter.format(instant); }
    }
}
