package com.bandadau.identity.adapter.in.web;

import com.bandadau.identity.adapter.in.web.dto.Responses.JwksResponse;
import com.bandadau.identity.application.port.in.GetJwksUseCase;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class JwksController {
    private final GetJwksUseCase jwks;

    public JwksController(GetJwksUseCase jwks) {
        this.jwks = jwks;
    }

    @GetMapping("/.well-known/jwks.json")
    public ResponseEntity<JwksResponse> getJwks() {
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(java.time.Duration.ofMinutes(5)).cachePublic())
                .body(new JwksResponse(jwks.publicKeys()));
    }
}
