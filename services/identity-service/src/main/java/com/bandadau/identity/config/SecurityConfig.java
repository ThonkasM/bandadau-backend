package com.bandadau.identity.config;

import com.bandadau.identity.adapter.in.web.ProblemFactory;
import com.bandadau.identity.adapter.out.external.JwtTokenIssuerAdapter;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.authorization.AuthorityAuthorizationManager;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.authorization.AuthorizationManagers;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;

@Configuration
public class SecurityConfig {

    @Bean
    JwtDecoder jwtDecoder(JwtTokenIssuerAdapter issuer, AppProperties props) {
        DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
        JWKSource<SecurityContext> source = (selector, context) -> selector.select(issuer.publicKeySet());
        processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, source));
        NimbusJwtDecoder decoder = new NimbusJwtDecoder(processor);
        OAuth2TokenValidator<Jwt> audience = jwt -> {
            List<String> aud = jwt.getAudience();
            boolean ok = aud != null && aud.stream().anyMatch(a -> a.equals("bandada-app") || a.equals("bandada-admin")
                    || a.equals("bandada-internal"));
            return ok ? OAuth2TokenValidatorResult.success()
                    : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "Invalid audience", null));
        };
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(new JwtTimestampValidator(Duration.ofSeconds(30)),
                new JwtIssuerValidator(props.jwt().issuer()), audience));
        return decoder;
    }

    @Bean
    JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            Collection<GrantedAuthority> authorities = new ArrayList<>();
            if ("service".equals(jwt.getClaimAsString("typ"))) {
                authorities.add(new SimpleGrantedAuthority("ROLE_SERVICE"));
                String scope = jwt.getClaimAsString("scope");
                if (scope != null) {
                    for (String s : scope.split(" ")) {
                        if (!s.isBlank()) authorities.add(new SimpleGrantedAuthority("SCOPE_" + s));
                    }
                }
            } else {
                authorities.add(new SimpleGrantedAuthority("ROLE_USER"));
                List<String> roles = jwt.getClaimAsStringList("roles");
                if (roles != null) roles.forEach(r -> authorities.add(new SimpleGrantedAuthority("ROLE_" + r)));
            }
            return authorities;
        });
        return converter;
    }

    private static AuthorizationManager<RequestAuthorizationContext> serviceWith(String scope) {
        return AuthorizationManagers.allOf(AuthorityAuthorizationManager.<RequestAuthorizationContext>hasRole("SERVICE"),
                AuthorityAuthorizationManager.<RequestAuthorizationContext>hasAuthority("SCOPE_" + scope));
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, JwtAuthenticationConverter converter,
                                            ProblemFactory problems) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(a -> a
                        .requestMatchers("/health/**").permitAll()
                        .requestMatchers("/.well-known/jwks.json").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/universities").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/register", "/api/v1/auth/verify-email",
                                "/api/v1/auth/resend-code", "/api/v1/auth/login", "/api/v1/auth/refresh",
                                "/api/v1/auth/handoff/exchange", "/api/v1/auth/service-token").permitAll()
                        // D-7: /internal/** exige typ=service y el scope según el método (GET/HEAD leen, el resto escribe)
                        .requestMatchers(HttpMethod.GET, "/internal/**").access(serviceWith("internal:read"))
                        .requestMatchers(HttpMethod.HEAD, "/internal/**").access(serviceWith("internal:read"))
                        .requestMatchers("/internal/**").access(serviceWith("internal:write"))
                        .requestMatchers("/api/v1/auth/mcp-tokens/**").hasRole("ADMIN")
                        .requestMatchers("/api/v1/**").hasRole("USER")
                        .anyRequest().denyAll())
                .oauth2ResourceServer(o -> o
                        .jwt(j -> j.jwtAuthenticationConverter(converter))
                        .authenticationEntryPoint((request, response, ex) -> {
                            response.setHeader("WWW-Authenticate", "Bearer");
                            problems.write(request, response, 401, "UNAUTHORIZED", null, Map.of());
                        })
                        .accessDeniedHandler((request, response, ex) ->
                                problems.write(request, response, 403, "FORBIDDEN", null, Map.of())))
                .exceptionHandling(e -> e
                        .authenticationEntryPoint((request, response, ex) -> {
                            response.setHeader("WWW-Authenticate", "Bearer");
                            problems.write(request, response, 401, "UNAUTHORIZED", null, Map.of());
                        })
                        .accessDeniedHandler((request, response, ex) ->
                                problems.write(request, response, 403, "FORBIDDEN", null, Map.of())));
        return http.build();
    }
}
