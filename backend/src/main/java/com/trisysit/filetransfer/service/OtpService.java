package com.trisysit.filetransfer.service;

import com.trisysit.filetransfer.entity.OtpCode;
import com.trisysit.filetransfer.repository.OtpCodeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Optional;

@Service
public class OtpService {

    private static final int TTL_SECONDS  = 300;  // 5 minutes
    private static final int MAX_FAILED   = 5;
    private static final int LOCK_SECONDS = 300;  // 5 minutes

    private final OtpCodeRepository otpRepo;
    private final SecureRandom rng = new SecureRandom();

    public OtpService(OtpCodeRepository otpRepo) {
        this.otpRepo = otpRepo;
    }

    @Transactional
    public String create(String userId) {
        String code = String.format("%04d", rng.nextInt(10_000));
        Instant now = Instant.now();

        OtpCode record = otpRepo.findByUserIdAndPurpose(userId, "LOGIN")
                .orElse(new OtpCode());
        record.setUserId(userId);
        record.setOtp(code);
        record.setExpiresAt(now.plusSeconds(TTL_SECONDS));
        record.setConsumed(false);
        record.setFailedAttempts(0);
        record.setLockedUntil(null);
        record.setPurpose("LOGIN");
        otpRepo.save(record);
        return code;
    }

    @Transactional
    public OtpResult consume(String userId, String code) {
        Optional<OtpCode> opt = otpRepo.findByUserIdAndPurpose(userId, "LOGIN");
        if (opt.isEmpty()) return OtpResult.INVALID;

        OtpCode record = opt.get();
        Instant now = Instant.now();

        if (record.getLockedUntil() != null && now.isBefore(record.getLockedUntil()))
            return OtpResult.LOCKED;

        if (now.isAfter(record.getExpiresAt()))
            return OtpResult.EXPIRED;

        if (record.isConsumed())
            return OtpResult.INVALID;

        if (!record.getOtp().equals(code)) {
            int attempts = record.getFailedAttempts() + 1;
            record.setFailedAttempts(attempts);
            if (attempts >= MAX_FAILED)
                record.setLockedUntil(now.plusSeconds(LOCK_SECONDS));
            otpRepo.save(record);
            return OtpResult.INVALID;
        }

        record.setConsumed(true);
        record.setFailedAttempts(0);
        record.setLockedUntil(null);
        otpRepo.save(record);
        return OtpResult.OK;
    }

    public enum OtpResult { OK, INVALID, EXPIRED, LOCKED }
}
