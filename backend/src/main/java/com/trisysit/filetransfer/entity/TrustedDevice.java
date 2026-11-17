package com.trisysit.filetransfer.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "trusted_device", indexes = @Index(name = "idx_trusted_device_user", columnList = "user_id"))
public class TrustedDevice extends BaseEntity {

    @Column(name = "user_id", nullable = false, length = 36)
    private String userId;

    @Column(name = "selector", nullable = false, unique = true, length = 32)
    private String selector;

    @Column(name = "token_hash", nullable = false, length = 64)
    private String tokenHash;

    @Column(name = "previous_token_hash", length = 64)
    private String previousTokenHash;

    @Column(name = "rotated_at")
    private Instant rotatedAt;

    @Column(name = "user_agent", length = 255)
    private String userAgent;

    @Column(name = "last_used_at")
    private Instant lastUsedAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    public TrustedDevice() {}

    public String getUserId()                     { return userId; }
    public void setUserId(String v)               { this.userId = v; }
    public String getSelector()                   { return selector; }
    public void setSelector(String v)             { this.selector = v; }
    public String getTokenHash()                  { return tokenHash; }
    public void setTokenHash(String v)            { this.tokenHash = v; }
    public String getPreviousTokenHash()          { return previousTokenHash; }
    public void setPreviousTokenHash(String v)    { this.previousTokenHash = v; }
    public Instant getRotatedAt()                 { return rotatedAt; }
    public void setRotatedAt(Instant v)           { this.rotatedAt = v; }
    public String getUserAgent()                  { return userAgent; }
    public void setUserAgent(String v)            { this.userAgent = v; }
    public Instant getLastUsedAt()                { return lastUsedAt; }
    public void setLastUsedAt(Instant v)          { this.lastUsedAt = v; }
    public Instant getExpiresAt()                 { return expiresAt; }
    public void setExpiresAt(Instant v)           { this.expiresAt = v; }
}
