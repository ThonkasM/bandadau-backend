package com.bandadau.events.infrastructure.security;

import com.bandadau.events.application.port.IdempotencyStore;
import com.bandadau.events.infrastructure.config.AppProperties;
import com.bandadau.events.interfaces.rest.IdempotencyFilter;
import com.bandadau.events.interfaces.rest.ProblemFactory;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.util.matcher.RequestMatcher;
import tools.jackson.databind.ObjectMapper;

@Configuration
public class SecurityConfig {

    @Bean
    JwtDecoder jwtDecoder(AppProperties props) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(props.jwt().jwksUrl()).jwsAlgorithm(SignatureAlgorithm.RS256).build();
        OAuth2TokenValidator<Jwt> audience = jwt -> {
            List<String> aud = jwt.getAudience();
            boolean service = "service".equals(jwt.getClaimAsString("typ"));
            boolean ok = aud != null && (service ? aud.contains("bandada-internal")
                    : aud.contains("bandada-app") || aud.contains("bandada-admin"));
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
            } else {
                authorities.add(new SimpleGrantedAuthority("ROLE_USER"));
                List<String> roles = jwt.getClaimAsStringList("roles");
                if (roles != null) roles.forEach(r -> authorities.add(new SimpleGrantedAuthority("ROLE_" + r)));
            }
            return authorities;
        });
        return converter;
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, JwtAuthenticationConverter converter, ProblemFactory problems,
                                            IdempotencyStore store, ObjectMapper mapper) throws Exception {
        RequestMatcher publicList = request -> "GET".equals(request.getMethod())
                && "/api/v1/events".equals(request.getRequestURI()) && "true".equals(request.getParameter("public"));
        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(a -> a
                        .requestMatchers("/health/**").permitAll()
                        .requestMatchers(publicList).permitAll()
                        .requestMatchers("/internal/**").hasRole("SERVICE")
                        .requestMatchers(org.springframework.http.HttpMethod.POST, "/api/v1/events", "/api/v1/events/*/publish")
                        .hasRole("ORGANIZER")
                        .requestMatchers(org.springframework.http.HttpMethod.POST, "/api/v1/events/*/cancel")
                        .hasAnyRole("ORGANIZER", "ADMIN")
                        .requestMatchers("/api/v1/**").hasRole("USER")
                        .anyRequest().denyAll())
                .oauth2ResourceServer(o -> o
                        .jwt(j -> j.jwtAuthenticationConverter(converter))
                        .authenticationEntryPoint((request, response, ex) -> {
                            response.setHeader("WWW-Authenticate", "Bearer");
                            problems.write(request, response, 401, "UNAUTHORIZED", null, Map.of());
                        })
                        .accessDeniedHandler((request, response, ex) -> problems.write(request, response, 403, "FORBIDDEN", null, Map.of())))
                .exceptionHandling(e -> e
                        .authenticationEntryPoint((request, response, ex) -> {
                            response.setHeader("WWW-Authenticate", "Bearer");
                            problems.write(request, response, 401, "UNAUTHORIZED", null, Map.of());
                        })
                        .accessDeniedHandler((request, response, ex) -> problems.write(request, response, 403, "FORBIDDEN", null, Map.of())))
                .addFilterAfter(new IdempotencyFilter(store, problems, mapper), AuthorizationFilter.class);
        return http.build();
    }
}
