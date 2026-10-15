package com.bandadau.identity.application.port.out;

import com.bandadau.identity.domain.model.SigningKey;
import java.util.List;

public interface SigningKeyRepositoryPort {
    List<SigningKey> findAll();

    void insert(SigningKey key);

    void update(SigningKey key);
}
