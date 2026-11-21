package com.trisysit.filetransfer.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.util.Date;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class JwtService {

    @Value("${app.jwt-secret}")
    private String secret;

    // Sliding window: every token lives this long from when it was issued, and active use re-issues it.
    private static final long EXPIRY_MS = 48L * 60 * 60 * 1000;
    // A token younger than this is not re-issued, so a busy page does not set a cookie on every request.
    private static final long RENEW_AFTER_MS = 5L * 60 * 1000;

    private SecretKey cachedKey;

    @PostConstruct
    public void init() {
        cachedKey = Keys.hmacShaKeyFor(Decoders.BASE64.decode(secret));
    }

    // jti → expiry epoch-ms; used to invalidate tokens on logout
    private final Map<String, Long> revokedJtis = new ConcurrentHashMap<>();

    public String generate(String username, String role) {
        return build(UUID.randomUUID().toString(), username, role);
    }

    public long sessionLifetimeSeconds() {
        return EXPIRY_MS / 1000;
    }

    /**
     * A fresh token for an active session, or empty if this one is still young. The token id is
     * kept, so revoking it on logout covers every renewed copy.
     */
    public Optional<String> renew(String token) {
        try {
            Claims claims = parse(token);
            if (System.currentTimeMillis() - claims.getIssuedAt().getTime() < RENEW_AFTER_MS) return Optional.empty();
            return Optional.of(build(claims.getId(), claims.getSubject(), claims.get("role", String.class)));
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    private String build(String jti, String username, String role) {
        return Jwts.builder()
                .id(jti)
                .subject(username)
                .claim("role", role)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + EXPIRY_MS))
                .signWith(secretKey())
                .compact();
    }

    public Claims parse(String token) {
        return Jwts.parser()
                .verifyWith(secretKey())
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public boolean isValid(String token) {
        try {
            Claims claims = parse(token);
            return !revokedJtis.containsKey(claims.getId());
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }

    public void revoke(String token) {
        try {
            Claims claims = parse(token);
            // Renewed copies of this token outlive its own expiry, so keep the revocation a full window.
            revokedJtis.put(claims.getId(), System.currentTimeMillis() + EXPIRY_MS);
        } catch (JwtException | IllegalArgumentException ignored) {}
    }

    public String extractUsername(String token) {
        return parse(token).getSubject();
    }

    public String extractRole(String token) {
        return parse(token).get("role", String.class);
    }

    // Remove JTIs for tokens that have naturally expired (every 30 minutes)
    @Scheduled(fixedRate = 30 * 60 * 1000)
    public void cleanupRevocations() {
        long now = System.currentTimeMillis();
        revokedJtis.entrySet().removeIf(e -> e.getValue() < now);
    }

    private SecretKey secretKey() {
        return cachedKey;
    }
}
