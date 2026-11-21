package com.trisysit.filetransfer.service;

import com.trisysit.filetransfer.entity.TotpCredential;
import com.trisysit.filetransfer.repository.TotpCredentialRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * RFC 6238 TOTP — HMAC-SHA1, 6 digits, 30-second steps, which is what every
 * authenticator app assumes when a QR code omits those parameters.
 *
 * Codes one step either side of now are accepted so a phone with a slightly
 * wrong clock still works, and the highest accepted step is recorded so the
 * same code cannot be replayed inside its own window.
 */
@Service
public class TotpService {

    private static final int DIGITS       = 6;
    private static final int PERIOD_SEC   = 30;
    private static final int SKEW_STEPS   = 1;
    private static final int SECRET_BYTES = 20;  // 160 bits, per RFC 4226
    private static final int MAX_FAILED   = 5;
    private static final int LOCK_SECONDS = 300;

    private static final String BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private static final SecureRandom RANDOM = new SecureRandom();

    public enum Result { OK, INVALID, LOCKED, NOT_ENROLLED }

    /** A secret that has been issued but not yet confirmed by a code. */
    public record Pending(String secret, String otpauthUri) {}

    private final TotpCredentialRepository repo;
    private final String issuer;

    public TotpService(TotpCredentialRepository repo,
                       @Value("${app.totp-issuer:File Transfer}") String issuer) {
        this.repo   = repo;
        this.issuer = issuer;
    }

    public boolean isEnrolled(String userId) {
        return repo.findByUserId(userId).map(c -> c.getEnrolledAt() != null).orElse(false);
    }

    public Set<String> enrolledUserIds() {
        return new HashSet<>(repo.findEnrolledUserIds());
    }

    /**
     * Issues a fresh secret for {@code userId} and returns it with the otpauth URI
     * to render as a QR code. Any previous secret is discarded, so the caller must
     * check {@link #isEnrolled} first unless a reset is intended.
     */
    @Transactional
    public Pending beginEnrollment(String userId, String accountLabel) {
        TotpCredential cred = repo.findByUserId(userId).orElseGet(TotpCredential::new);
        cred.setUserId(userId);
        cred.setSecret(newSecret());
        cred.setEnrolledAt(null);
        cred.setLastStep(0);
        cred.setFailedAttempts(0);
        cred.setLockedUntil(null);
        repo.save(cred);
        return new Pending(cred.getSecret(), otpauthUri(cred.getSecret(), accountLabel));
    }

    /** Confirms a pending enrollment with the first code from the app. */
    @Transactional
    public boolean activate(String userId, String code) {
        TotpCredential cred = repo.findByUserId(userId).orElse(null);
        if (cred == null || cred.getEnrolledAt() != null) return false;
        if (verify(userId, code) != Result.OK) return false;
        cred.setEnrolledAt(Instant.now());
        repo.save(cred);
        return true;
    }

    @Transactional
    public Result verify(String userId, String code) {
        TotpCredential cred = repo.findByUserId(userId).orElse(null);
        if (cred == null) return Result.NOT_ENROLLED;

        Instant now = Instant.now();
        if (cred.getLockedUntil() != null && now.isBefore(cred.getLockedUntil())) return Result.LOCKED;
        if (cred.getLockedUntil() != null) {
            // Lock served — start a fresh count, or one typo would re-lock immediately.
            cred.setLockedUntil(null);
            cred.setFailedAttempts(0);
        }

        String digits = code == null ? "" : code.replaceAll("\\D", "");
        if (digits.length() != DIGITS) return countFailure(cred, now);

        long currentStep = now.getEpochSecond() / PERIOD_SEC;
        byte[] key = base32Decode(cred.getSecret());

        for (long step = currentStep - SKEW_STEPS; step <= currentStep + SKEW_STEPS; step++) {
            if (step <= cred.getLastStep()) continue; // already used — replay
            if (!constantTimeEquals(digits, codeAt(key, step))) continue;
            cred.setLastStep(step);
            cred.setFailedAttempts(0);
            cred.setLockedUntil(null);
            repo.save(cred);
            return Result.OK;
        }
        return countFailure(cred, now);
    }

    /** Drops the enrollment entirely — the user falls back to a one-time email code and re-enrolls. */
    @Transactional
    public void reset(String userId) {
        repo.deleteByUserId(userId);
    }

    // ── internals ────────────────────────────────────────────────────────────

    private Result countFailure(TotpCredential cred, Instant now) {
        int attempts = cred.getFailedAttempts() + 1;
        cred.setFailedAttempts(attempts);
        if (attempts >= MAX_FAILED) cred.setLockedUntil(now.plusSeconds(LOCK_SECONDS));
        repo.save(cred);
        return cred.getLockedUntil() != null && now.isBefore(cred.getLockedUntil())
                ? Result.LOCKED : Result.INVALID;
    }

    private String otpauthUri(String secret, String accountLabel) {
        String iss  = URLEncoder.encode(issuer, StandardCharsets.UTF_8);
        String acct = URLEncoder.encode(accountLabel, StandardCharsets.UTF_8);
        return "otpauth://totp/" + iss + ":" + acct
                + "?secret="    + secret
                + "&issuer="    + iss
                + "&algorithm=SHA1&digits=" + DIGITS + "&period=" + PERIOD_SEC;
    }

    private static String newSecret() {
        byte[] bytes = new byte[SECRET_BYTES];
        RANDOM.nextBytes(bytes);
        return base32Encode(bytes);
    }

    private static String codeAt(byte[] key, long step) {
        byte[] counter = new byte[8];
        long value = step;
        for (int i = 7; i >= 0; i--) {
            counter[i] = (byte) (value & 0xFF);
            value >>= 8;
        }
        byte[] hash;
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(key, "HmacSHA1"));
            hash = mac.doFinal(counter);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HMAC-SHA1 unavailable", e);
        }
        int offset = hash[hash.length - 1] & 0x0F;
        int binary = ((hash[offset]     & 0x7F) << 24)
                   | ((hash[offset + 1] & 0xFF) << 16)
                   | ((hash[offset + 2] & 0xFF) << 8)
                   |  (hash[offset + 3] & 0xFF);
        return String.format("%0" + DIGITS + "d", binary % (int) Math.pow(10, DIGITS));
    }

    private static String base32Encode(byte[] data) {
        StringBuilder sb = new StringBuilder();
        int buffer = 0, bitsLeft = 0;
        for (byte b : data) {
            buffer = (buffer << 8) | (b & 0xFF);
            bitsLeft += 8;
            while (bitsLeft >= 5) {
                sb.append(BASE32.charAt((buffer >> (bitsLeft - 5)) & 0x1F));
                bitsLeft -= 5;
            }
        }
        if (bitsLeft > 0) sb.append(BASE32.charAt((buffer << (5 - bitsLeft)) & 0x1F));
        return sb.toString();
    }

    private static byte[] base32Decode(String encoded) {
        byte[] out = new byte[encoded.length() * 5 / 8];
        int buffer = 0, bitsLeft = 0, index = 0;
        for (char c : encoded.toCharArray()) {
            int value = BASE32.indexOf(Character.toUpperCase(c));
            if (value < 0) continue;
            buffer = (buffer << 5) | value;
            bitsLeft += 5;
            if (bitsLeft >= 8) {
                out[index++] = (byte) ((buffer >> (bitsLeft - 8)) & 0xFF);
                bitsLeft -= 8;
            }
        }
        return out;
    }

    private static boolean constantTimeEquals(String a, String b) {
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }
}
