package com.trisysit.filetransfer.repository;

import com.trisysit.filetransfer.entity.OtpCode;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface OtpCodeRepository extends JpaRepository<OtpCode, String> {
    Optional<OtpCode> findByUserIdAndPurpose(String userId, String purpose);
}
