package com.trisysit.filetransfer.repository;

import com.trisysit.filetransfer.entity.RetentionHold;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RetentionHoldRepository extends JpaRepository<RetentionHold, String> {
    List<RetentionHold> findByOwnerDir(String ownerDir);
    Optional<RetentionHold> findByOwnerDirAndPath(String ownerDir, String path);
}
