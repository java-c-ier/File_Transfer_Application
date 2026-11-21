package com.trisysit.filetransfer.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "totp_credential")
public class TotpCredential extends BaseEntity {

    @Column(name = "user_id", nullable = false, unique = true, length = 36)
    private String userId;

    @Column(name = "secret", nullable = false, length = 64)
    private String secret;

    /** Null while enrollment is pending — the secret exists but no code has confirmed it yet. */
    @Column(name = "enrolled_at")
    private Instant enrolledAt;

    /** Highest time step already accepted; blocks replay of a code within its 30-second window. */
    @Column(name = "last_step", nullable = false)
    private long lastStep = 0;

    @Column(name = "failed_attempts", nullable = false)
    private int failedAttempts = 0;

    @Column(name = "locked_until")
    private Instant lockedUntil;

    public TotpCredential() {}

    public String getUserId()              { return userId; }
    public void setUserId(String v)        { this.userId = v; }
    public String getSecret()              { return secret; }
    public void setSecret(String v)        { this.secret = v; }
    public Instant getEnrolledAt()         { return enrolledAt; }
    public void setEnrolledAt(Instant v)   { this.enrolledAt = v; }
    public long getLastStep()              { return lastStep; }
    public void setLastStep(long v)        { this.lastStep = v; }
    public int getFailedAttempts()         { return failedAttempts; }
    public void setFailedAttempts(int v)   { this.failedAttempts = v; }
    public Instant getLockedUntil()        { return lockedUntil; }
    public void setLockedUntil(Instant v)  { this.lockedUntil = v; }
}
