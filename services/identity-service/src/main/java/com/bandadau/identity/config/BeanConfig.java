package com.bandadau.identity.config;

import com.bandadau.identity.adapter.in.web.*;
import com.bandadau.identity.adapter.out.external.*;
import com.bandadau.identity.adapter.out.messaging.OutboxEventPublisherAdapter;
import com.bandadau.identity.adapter.out.messaging.OutboxRelay;
import com.bandadau.identity.adapter.out.persistence.*;
import com.bandadau.identity.application.AuthSettings;
import com.bandadau.identity.application.port.in.*;
import com.bandadau.identity.application.port.out.*;
import com.bandadau.identity.application.service.*;
import java.time.Clock;
import org.springframework.amqp.core.Declarables;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.MessageSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/** Composition root: wires adapters to ports and use cases (application services carry no Spring annotations). */
@Configuration
@EnableScheduling
public class BeanConfig {

    @Bean Clock clock() { return Clock.systemUTC(); }

    @Bean ClockPort clockPort(Clock clock) { return new SystemClockAdapter(clock); }

    @Bean IdGeneratorPort idGenerator() { return new UuidV7IdGenerator(); }

    @Bean SecretsPort secrets() { return new SecureSecretsAdapter(); }

    @Bean PasswordHasherPort passwordHasher() { return new Argon2PasswordHasherAdapter(); }

    @Bean TransactionPort transactionPort(TransactionTemplate template) { return new SpringTransactionAdapter(template); }

    @Bean UserRepositoryPort userRepository(JdbcClient jdbc) { return new JdbcUserRepository(jdbc); }

    @Bean CredentialRepositoryPort credentialRepository(JdbcClient jdbc) { return new JdbcCredentialRepository(jdbc); }

    @Bean EmailVerificationRepositoryPort emailVerificationRepository(JdbcClient jdbc) {
        return new JdbcEmailVerificationRepository(jdbc);
    }

    @Bean UniversityRepositoryPort universityRepository(JdbcClient jdbc) { return new JdbcUniversityRepository(jdbc); }

    @Bean RefreshTokenRepositoryPort refreshTokenRepository(JdbcClient jdbc) { return new JdbcRefreshTokenRepository(jdbc); }

    @Bean HandoffCodeRepositoryPort handoffCodeRepository(JdbcClient jdbc) { return new JdbcHandoffCodeRepository(jdbc); }

    @Bean SigningKeyRepositoryPort signingKeyRepository(JdbcClient jdbc) { return new JdbcSigningKeyRepository(jdbc); }

    @Bean IdempotencyStorePort idempotencyStore(JdbcClient jdbc, TransactionTemplate tx, ObjectMapper mapper, Clock clock) {
        return new JdbcIdempotencyStore(jdbc, tx, mapper, clock);
    }

    @Bean EventPublisherPort eventPublisher(JdbcClient jdbc, ObjectMapper mapper, IdGeneratorPort ids, ClockPort clock) {
        return new OutboxEventPublisherAdapter(jdbc, mapper, ids, clock);
    }

    @Bean OutboxRelay outboxRelay(JdbcClient jdbc, TransactionTemplate tx, RabbitTemplate rabbit, ObjectMapper mapper,
                                  AppProperties props) {
        return new OutboxRelay(jdbc, tx, rabbit, mapper, props.outbox().batchSize());
    }

    @Bean VerificationCodeSenderPort verificationCodeSender(JavaMailSender mail, MessageSource messages, AppProperties props) {
        return new SmtpVerificationCodeSenderAdapter(mail, messages, props.mail().from(), props.mail().logCode());
    }

    @Bean EnvServiceClientRegistry serviceClients(AppProperties props) {
        return new EnvServiceClientRegistry(props.serviceClients());
    }

    @Bean JwtTokenIssuerAdapter tokenIssuer(SigningKeyRepositoryPort keys, TransactionPort tx, ClockPort clock,
                                            IdGeneratorPort ids, AppProperties props) {
        AppProperties.Jwt jwt = props.jwt();
        return new JwtTokenIssuerAdapter(keys, tx, clock, ids, new JwtTokenIssuerAdapter.Settings(jwt.issuer(), jwt.kek(),
                jwt.keyId(), jwt.privateKeyPath(), jwt.rotationInterval(), jwt.activationDelay(), jwt.retiringGrace()));
    }

    @Bean ApplicationRunner initSigningKeys(JwtTokenIssuerAdapter issuer) { return args -> issuer.initialize(); }

    @Bean AuthSettings authSettings(AppProperties props) {
        AppProperties.Tokens t = props.tokens();
        return new AuthSettings(t.accessTtl(), t.refreshTtl(), t.adminRefreshTtl(), t.handoffTtl(), t.verificationTtl(),
                t.serviceTokenTtl(), trimSlash(props.urls().appBaseUrl()), trimSlash(props.urls().adminBaseUrl()),
                props.web().hideExistingAccounts());
    }

    private static String trimSlash(String url) { return url.endsWith("/") ? url.substring(0, url.length() - 1) : url; }

    @Bean RegisterUserUseCase registerUser(UserRepositoryPort users, UniversityRepositoryPort universities,
                                           CredentialRepositoryPort credentials, EmailVerificationRepositoryPort verifications,
                                           PasswordHasherPort hasher, SecretsPort secrets, VerificationCodeSenderPort sender,
                                           ClockPort clock, IdGeneratorPort ids, TransactionPort tx, AuthSettings settings) {
        return new RegisterUserService(users, universities, credentials, verifications, hasher, secrets, sender, clock, ids,
                tx, settings);
    }

    @Bean VerifyEmailUseCase verifyEmail(UserRepositoryPort users, EmailVerificationRepositoryPort verifications,
                                         EventPublisherPort events, RefreshTokenRepositoryPort refresh, TokenIssuerPort tokens,
                                         SecretsPort secrets, ClockPort clock, IdGeneratorPort ids, TransactionPort tx,
                                         AuthSettings settings) {
        return new VerifyEmailService(users, verifications, events, refresh, tokens, secrets, clock, ids, tx, settings);
    }

    @Bean ResendVerificationCodeUseCase resendCode(UserRepositoryPort users, EmailVerificationRepositoryPort verifications,
                                                   VerificationCodeSenderPort sender, SecretsPort secrets, ClockPort clock,
                                                   IdGeneratorPort ids, TransactionPort tx, AuthSettings settings) {
        return new ResendVerificationCodeService(users, verifications, sender, secrets, clock, ids, tx, settings);
    }

    @Bean LoginUseCase login(UserRepositoryPort users, CredentialRepositoryPort credentials, PasswordHasherPort hasher,
                             RefreshTokenRepositoryPort refresh, TokenIssuerPort tokens, SecretsPort secrets, ClockPort clock,
                             IdGeneratorPort ids, TransactionPort tx, AuthSettings settings) {
        return new LoginService(users, credentials, hasher, refresh, tokens, secrets, clock, ids, tx, settings);
    }

    @Bean RefreshTokenService refreshTokenService(RefreshTokenRepositoryPort refresh, UserRepositoryPort users,
                                                  TokenIssuerPort tokens, SecretsPort secrets, ClockPort clock,
                                                  IdGeneratorPort ids, TransactionPort tx, AuthSettings settings) {
        return new RefreshTokenService(refresh, users, tokens, secrets, clock, ids, tx, settings);
    }

    @Bean HandoffService handoffService(HandoffCodeRepositoryPort codes, UserRepositoryPort users,
                                        RefreshTokenRepositoryPort refresh, TokenIssuerPort tokens, SecretsPort secrets,
                                        ClockPort clock, IdGeneratorPort ids, TransactionPort tx, AuthSettings settings) {
        return new HandoffService(codes, users, refresh, tokens, secrets, clock, ids, tx, settings);
    }

    @Bean IssueServiceTokenUseCase issueServiceToken(ServiceClientRegistryPort clients, TokenIssuerPort tokens,
                                                     AuthSettings settings) {
        return new ServiceTokenService(clients, tokens, settings);
    }

    @Bean UserService userService(UserRepositoryPort users, EventPublisherPort events, TokenIssuerPort tokens,
                                  ClockPort clock, TransactionPort tx) {
        return new UserService(users, events, tokens, clock, tx);
    }

    @Bean ManageUsersUseCase manageUsers(UserRepositoryPort users, RefreshTokenRepositoryPort refresh,
                                         EventPublisherPort events, ClockPort clock, TransactionPort tx) {
        return new ManageUsersService(users, refresh, events, clock, tx);
    }

    @Bean UniversityService universityService(UniversityRepositoryPort universities, IdGeneratorPort ids, TransactionPort tx) {
        return new UniversityService(universities, ids, tx);
    }

    @Bean ProblemFactory problemFactory(MessageSource messages, ObjectMapper mapper) {
        return new ProblemFactory(messages, mapper);
    }

    @Bean RateLimiter rateLimiter(AppProperties props) { return new RateLimiter(props.web().rateLimitEnabled()); }

    @Bean AuthController.Settings authControllerSettings(AppProperties props) {
        AppProperties.Web web = props.web();
        return new AuthController.Settings(web.cookieSecure(), web.corsOrigins(), web.handoffPerMinute(),
                web.resendMinInterval(), web.resendPerHour());
    }

    @Bean FilterRegistrationBean<RequestContextFilter> correlationFilterRegistration() {
        FilterRegistrationBean<RequestContextFilter> bean = new FilterRegistrationBean<>(new RequestContextFilter());
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return bean;
    }

    @Bean FilterRegistrationBean<RateLimitFilter> rateLimitFilterRegistration(RateLimiter limiter, ProblemFactory problems,
                                                                  AppProperties props) {
        FilterRegistrationBean<RateLimitFilter> bean = new FilterRegistrationBean<>(
                new RateLimitFilter(limiter, problems, props.web().authPerMinute()));
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE + 10);
        return bean;
    }

    @Bean FilterRegistrationBean<IdempotencyFilter> idempotencyFilterRegistration(IdempotencyStorePort store, ProblemFactory problems,
                                                                      ObjectMapper mapper) {
        FilterRegistrationBean<IdempotencyFilter> bean = new FilterRegistrationBean<>(
                new IdempotencyFilter(store, problems, mapper));
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE + 20);
        return bean;
    }

    @Bean @ConditionalOnProperty(name = "bandada.rabbit.declare-topology", havingValue = "true")
    Declarables bandadaExchanges() {
        return new Declarables(new TopicExchange("bandada.events", true, false),
                new TopicExchange("bandada.commands", true, false), new TopicExchange("bandada.dlx", true, false));
    }
}
