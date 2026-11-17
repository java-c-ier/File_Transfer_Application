package com.trisysit.filetransfer.service;

import com.trisysit.filetransfer.entity.TrustedDevice;
import com.trisysit.filetransfer.repository.TrustedDeviceRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * "Remember this device": the browser holds {@code selector.secret}; only SHA-256(secret) is stored.
 * The secret is replaced on every use, and reuse of an old secret revokes all of the user's devices.
 */
@Service
public class TrustedDeviceService {

    private static final Logger log = LoggerFactory.getLogger(TrustedDeviceService.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    // Two tabs clicking at once both present the same secret; allow the loser briefly.
    private static final Duration ROTATION_GRACE = Duration.ofSeconds(60);
    private static final int SELECTOR_LEN = 32; // 16 random bytes, hex
    private static final int SECRET_LEN   = 43; // 32 random bytes, unpadded base64url
    private static final Pattern SELECTOR_PATTERN = Pattern.compile("[0-9a-f]{" + SELECTOR_LEN + "}");

    public enum Outcome { NEW_TOKEN, KEEP_COOKIE }

    public record Verified(TrustedDevice device, Outcome outcome) {}

    private final TrustedDeviceRepository repo;
    private final Duration lifetime;

    public TrustedDeviceService(TrustedDeviceRepository repo,
                                @Value("${app.trusted-device-days:30}") long days) {
        this.repo = repo;
        this.lifetime = Duration.ofDays(days);
    }

    public Duration lifetime() {
        return lifetime;
    }

    /** Creates a remembered device and returns the cookie value. */
    @Transactional
    public String issue(String userId, String userAgent) {
        String selector = HexFormat.of().formatHex(randomBytes(16));
        String secret = newSecret();
        TrustedDevice d = new TrustedDevice();
        d.setUserId(userId);
        d.setSelector(selector);
        d.setTokenHash(sha256(secret));
        d.setUserAgent(truncate(userAgent, 255));
        d.setLastUsedAt(Instant.now());
        d.setExpiresAt(Instant.now().plus(lifetime));
        repo.save(d);
        return selector + "." + secret;
    }

    /** Checks a cookie value without changing anything (except revoking on detected theft). */
    @Transactional
    public Optional<Verified> peek(String cookieValue) {
        return match(cookieValue);
    }

    /** Checks a cookie value and, if valid, rotates its secret. newCookieValue is null when the browser should keep its cookie. */
    @Transactional
    public Optional<RotateResult> verifyAndRotate(String cookieValue) {
        Optional<Verified> v = match(cookieValue);
        if (v.isEmpty()) return Optional.empty();

        TrustedDevice d = v.get().device();
        Instant now = Instant.now();
        d.setLastUsedAt(now);
        d.setExpiresAt(now.plus(lifetime));

        if (v.get().outcome() == Outcome.KEEP_COOKIE) {
            repo.save(d);
            return Optional.of(new RotateResult(d, null));
        }

        String secret = newSecret();
        d.setPreviousTokenHash(d.getTokenHash());
        d.setRotatedAt(now);
        d.setTokenHash(sha256(secret));
        repo.save(d);
        return Optional.of(new RotateResult(d, d.getSelector() + "." + secret));
    }

    public record RotateResult(TrustedDevice device, String newCookieValue) {}

    @Transactional
    public void forget(String cookieValue) {
        match(cookieValue).ifPresent(v -> repo.delete(v.device()));
    }

    @Transactional
    public void revokeAllForUser(String userId) {
        repo.deleteAllForUser(userId);
    }

    // Daily at 03:45 server time; expired rows are also rejected on read, so this is only housekeeping.
    @Scheduled(cron = "${app.trusted-device-purge-cron:0 45 3 * * *}")
    public void purgeExpired() {
        try {
            int n = repo.deleteExpired(Instant.now());
            if (n > 0) log.info("[TRUSTED_DEVICE] purged_expired count={}", n);
        } catch (RuntimeException e) {
            log.error("[TRUSTED_DEVICE] purge_failed", e);
        }
    }

    private Optional<Verified> match(String cookieValue) {
        // Reject malformed values before touching the database.
        if (cookieValue == null || cookieValue.length() != SELECTOR_LEN + 1 + SECRET_LEN
                || cookieValue.charAt(SELECTOR_LEN) != '.') return Optional.empty();
        String selector = cookieValue.substring(0, SELECTOR_LEN);
        if (!SELECTOR_PATTERN.matcher(selector).matches()) return Optional.empty();
        String hash = sha256(cookieValue.substring(SELECTOR_LEN + 1));

        Optional<TrustedDevice> opt = repo.findBySelector(selector);
        if (opt.isEmpty()) return Optional.empty();
        TrustedDevice d = opt.get();

        if (d.getExpiresAt().isBefore(Instant.now())) {
            repo.delete(d);
            return Optional.empty();
        }
        if (constantTimeEquals(hash, d.getTokenHash())) {
            return Optional.of(new Verified(d, Outcome.NEW_TOKEN));
        }
        if (d.getPreviousTokenHash() != null && constantTimeEquals(hash, d.getPreviousTokenHash())
                && d.getRotatedAt() != null && d.getRotatedAt().plus(ROTATION_GRACE).isAfter(Instant.now())) {
            return Optional.of(new Verified(d, Outcome.KEEP_COOKIE));
        }

        log.warn("[TRUSTED_DEVICE] stale_secret_reused userId={} — revoking all devices", d.getUserId());
        repo.deleteAllForUser(d.getUserId());
        return Optional.empty();
    }

    private static String newSecret() {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes(32));
    }

    private static byte[] randomBytes(int n) {
        byte[] b = new byte[n];
        RANDOM.nextBytes(b);
        return b;
    }

    private static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static boolean constantTimeEquals(String a, String b) {
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }

    private static String truncate(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }
}
