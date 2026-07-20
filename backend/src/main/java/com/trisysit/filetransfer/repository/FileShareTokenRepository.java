package com.trisysit.filetransfer.repository;

import com.trisysit.filetransfer.entity.FileShareToken;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface FileShareTokenRepository extends JpaRepository<FileShareToken, String> {
    Optional<FileShareToken> findByShareIdAndTokenIgnoreCaseAndUsedFalse(String shareId, String token);
}
