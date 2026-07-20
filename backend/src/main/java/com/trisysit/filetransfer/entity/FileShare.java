package com.trisysit.filetransfer.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "file_share")
public class FileShare extends BaseEntity {

    @Column(name = "file_path", nullable = false, length = 1000)
    private String filePath;

    @Column(name = "file_name", nullable = false, length = 500)
    private String fileName;

    @Column(name = "owner_username", nullable = false, length = 100)
    private String ownerUsername;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    public FileShare() {}

    public String getFilePath()                { return filePath; }
    public void setFilePath(String filePath)   { this.filePath = filePath; }
    public String getFileName()                { return fileName; }
    public void setFileName(String fileName)   { this.fileName = fileName; }
    public String getOwnerUsername()           { return ownerUsername; }
    public void setOwnerUsername(String v)     { this.ownerUsername = v; }
    public Instant getExpiresAt()              { return expiresAt; }
    public void setExpiresAt(Instant expiresAt){ this.expiresAt = expiresAt; }
}
