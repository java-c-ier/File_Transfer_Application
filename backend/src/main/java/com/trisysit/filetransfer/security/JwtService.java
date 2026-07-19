package com.trisysit.filetransfer.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.util.Date;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class JwtService {

    @Value("${app.jwt-secret}")
    private String secret;

    private static final long EXPIRY_MS = 24L * 60 * 60 * 1000;

    // jti → expiry epoch-ms; used to invalidate tokens on logout
    private final Map<String, Long> revokedJtis = new ConcurrentHashMap<>();

    public String generate(String username, String role) {
        return Jwts.builder()
                .id(UUID.randomUUID().toString())
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
            revokedJtis.put(claims.getId(), claims.getExpiration().getTime());
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
        byte[] keyBytes = Decoders.BASE64.decode(secret);
        return Keys.hmacShaKeyFor(keyBytes);
    }
}
