package com.trisysit.filetransfer.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "one_time_code",
       uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "purpose"}))
public class OtpCode extends BaseEntity {

    @Column(name = "user_id", nullable = false, length = 36)
    private String userId;

    @Column(name = "otp", nullable = false, length = 4)
    private String otp;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "consumed", nullable = false)
    private boolean consumed = false;

    @Column(name = "failed_attempts", nullable = false)
    private int failedAttempts = 0;

    @Column(name = "locked_until")
    private Instant lockedUntil;

    @Column(name = "purpose", nullable = false, length = 20)
    private String purpose = "LOGIN";

    public OtpCode() {}

    public String getUserId()                  { return userId; }
    public void setUserId(String userId)       { this.userId = userId; }
    public String getOtp()                     { return otp; }
    public void setOtp(String otp)             { this.otp = otp; }
    public Instant getExpiresAt()              { return expiresAt; }
    public void setExpiresAt(Instant t)        { this.expiresAt = t; }
    public boolean isConsumed()                { return consumed; }
    public void setConsumed(boolean v)         { this.consumed = v; }
    public int getFailedAttempts()             { return failedAttempts; }
    public void setFailedAttempts(int n)       { this.failedAttempts = n; }
    public Instant getLockedUntil()            { return lockedUntil; }
    public void setLockedUntil(Instant t)      { this.lockedUntil = t; }
    public String getPurpose()                 { return purpose; }
    public void setPurpose(String purpose)     { this.purpose = purpose; }
}
