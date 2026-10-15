package com.bandadau.identity.application.port.in;

import java.util.List;
import java.util.Map;

public interface GetJwksUseCase {
    List<Map<String, Object>> publicKeys();
}
