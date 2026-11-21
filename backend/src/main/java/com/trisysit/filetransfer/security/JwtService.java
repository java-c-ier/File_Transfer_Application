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
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class JwtService {

    @Value("${app.jwt-secret}")
    private String secret;

    private static final long EXPIRY_MS = 24L * 60 * 60 * 1000;

    // A ticket proves an email code was just verified; it only unlocks authenticator
    // enrollment, never the API, so the two kinds are told apart by "purpose".
    private static final String PURPOSE_SESSION = "session";
    private static final String PURPOSE_ENROLL  = "enroll";
    private static final long   ENROLL_EXPIRY_MS = 10L * 60 * 1000;

    private SecretKey cachedKey;

    @PostConstruct
    public void init() {
        cachedKey = Keys.hmacShaKeyFor(Decoders.BASE64.decode(secret));
    }

    // jti → expiry epoch-ms; used to invalidate tokens on logout
    private final Map<String, Long> revokedJtis = new ConcurrentHashMap<>();

    public String generate(String username, String role) {
        return Jwts.builder()
                .id(UUID.randomUUID().toString())
                .subject(username)
                .claim("role", role)
                .claim("purpose", PURPOSE_SESSION)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + EXPIRY_MS))
                .signWith(secretKey())
                .compact();
    }

    public String generateEnrollmentTicket(String username) {
        return Jwts.builder()
                .id(UUID.randomUUID().toString())
                .subject(username)
                .claim("purpose", PURPOSE_ENROLL)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + ENROLL_EXPIRY_MS))
                .signWith(secretKey())
                .compact();
    }

    /** Username carried by a live enrollment ticket, or empty if it is expired, spent or a session token. */
    public Optional<String> enrollmentSubject(String ticket) {
        try {
            Claims claims = parse(ticket);
            if (!PURPOSE_ENROLL.equals(claims.get("purpose", String.class))) return Optional.empty();
            if (revokedJtis.containsKey(claims.getId())) return Optional.empty();
            return Optional.ofNullable(claims.getSubject());
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
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
            if (!PURPOSE_SESSION.equals(claims.get("purpose", String.class))) return false;
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
        return cachedKey;
    }
}
