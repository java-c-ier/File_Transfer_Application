package com.trisysit.filetransfer.repository;

import com.trisysit.filetransfer.entity.TotpCredential;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

public interface TotpCredentialRepository extends JpaRepository<TotpCredential, String> {

    Optional<TotpCredential> findByUserId(String userId);

    @Query("SELECT c.userId FROM TotpCredential c WHERE c.enrolledAt IS NOT NULL")
    List<String> findEnrolledUserIds();

    @Transactional
    @Modifying
    @Query("DELETE FROM TotpCredential c WHERE c.userId = :userId")
    int deleteByUserId(@Param("userId") String userId);
}
