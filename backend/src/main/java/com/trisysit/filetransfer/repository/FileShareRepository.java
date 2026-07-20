package com.trisysit.filetransfer.repository;

import com.trisysit.filetransfer.entity.FileShare;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface FileShareRepository extends JpaRepository<FileShare, String> {
    Optional<FileShare> findByOwnerUsernameAndFilePath(String ownerUsername, String filePath);
}
