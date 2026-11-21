package com.trisysit.filetransfer.entity;

import jakarta.persistence.*;

/**
 * An admin's instruction to keep a file or folder past the retention period.
 * Held folders protect everything inside them. Uniqueness of (ownerDir, path) is
 * enforced in the service: the path column is too long for a MySQL unique index.
 */
@Entity
@Table(name = "retention_hold", indexes = @Index(name = "idx_retention_hold_owner", columnList = "owner_dir"))
public class RetentionHold extends BaseEntity {

    /** Folder name under the upload root, i.e. {@code PathUtils.dirName(username)}. */
    @Column(name = "owner_dir", nullable = false, length = 100)
    private String ownerDir;

    /** Path relative to the owner's folder, '/'-separated, no leading slash. */
    @Column(name = "path", nullable = false, length = 1000)
    private String path;

    public RetentionHold() {}

    public String getOwnerDir()            { return ownerDir; }
    public void setOwnerDir(String v)      { this.ownerDir = v; }
    public String getPath()                { return path; }
    public void setPath(String v)          { this.path = v; }
}
