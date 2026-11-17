package com.trisysit.filetransfer.repository;

import com.trisysit.filetransfer.entity.TrustedDevice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;

public interface TrustedDeviceRepository extends JpaRepository<TrustedDevice, String> {
    Optional<TrustedDevice> findBySelector(String selector);

    @Transactional
    @Modifying
    @Query("DELETE FROM TrustedDevice d WHERE d.userId = :userId")
    int deleteAllForUser(@Param("userId") String userId);

    @Transactional
    @Modifying
    @Query("DELETE FROM TrustedDevice d WHERE d.expiresAt < :now")
    int deleteExpired(@Param("now") Instant now);
}
