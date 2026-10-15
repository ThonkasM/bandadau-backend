package com.bandadau.identity.adapter.out.external;

import com.bandadau.identity.application.port.out.ServiceClientRegistryPort;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Service clients come from {@code SERVICE_CLIENTS=id:secret[:scope|scope],...} (development secrets only). */
public class EnvServiceClientRegistry implements ServiceClientRegistryPort {
    public static final List<String> DEFAULT_SCOPES = List.of("internal:read", "internal:write");

    private record Client(String secret, Set<String> scopes) { }

    private final Map<String, Client> clients = new HashMap<>();

    public EnvServiceClientRegistry(String spec) {
        if (spec == null || spec.isBlank()) return;
        for (String entry : spec.split(",")) {
            String[] parts = entry.trim().split(":", 3);
            if (parts.length < 2 || parts[0].isBlank() || parts[1].isBlank()) {
                throw new IllegalArgumentException("SERVICE_CLIENTS entries must look like id:secret[:scope|scope]");
            }
            Set<String> scopes = parts.length == 3 && !parts[2].isBlank()
                    ? new LinkedHashSet<>(Arrays.asList(parts[2].split("\\|"))) : new LinkedHashSet<>(DEFAULT_SCOPES);
            clients.put(parts[0].trim(), new Client(parts[1], scopes));
        }
    }

    public Set<String> clientIds() { return clients.keySet(); }

    @Override
    public Optional<Set<String>> authenticate(String clientId, String clientSecret) {
        Client client = clientId == null ? null : clients.get(clientId);
        byte[] expected = client == null ? new byte[32] : client.secret().getBytes(StandardCharsets.UTF_8);
        boolean same = MessageDigest.isEqual(expected, clientSecret == null ? new byte[0]
                : clientSecret.getBytes(StandardCharsets.UTF_8));
        return client != null && same ? Optional.of(client.scopes()) : Optional.empty();
    }
}
