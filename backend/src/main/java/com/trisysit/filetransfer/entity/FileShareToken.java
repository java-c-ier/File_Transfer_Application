package com.trisysit.filetransfer.entity;

import jakarta.persistence.*;

@Entity
@Table(name = "file_share_token")
public class FileShareToken extends BaseEntity {

    @Column(name = "share_id", nullable = false, length = 36)
    private String shareId;

    @Column(name = "token", nullable = false, length = 10)
    private String token;

    @Column(name = "used", nullable = false)
    private boolean used = false;

    public FileShareToken() {}

    public String getShareId()             { return shareId; }
    public void setShareId(String shareId) { this.shareId = shareId; }
    public String getToken()               { return token; }
    public void setToken(String token)     { this.token = token; }
    public boolean isUsed()                { return used; }
    public void setUsed(boolean used)      { this.used = used; }
}
