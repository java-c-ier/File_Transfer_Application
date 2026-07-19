package com.trisysit.filetransfer.entity;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.annotation.CreatedBy;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedBy;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.LocalDateTime;

@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
public abstract class BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(length = 36, nullable = false, updatable = false)
    private String id;

    @Column(name = "status", length = 20)
    private String status = "ACTIVE";

    @Column(name = "comments", columnDefinition = "TEXT")
    private String comments;

    @CreatedBy
    @Column(name = "created_by", length = 100, updatable = false)
    private String createdBy;

    @CreatedDate
    @Column(name = "created_date", updatable = false)
    private LocalDateTime createdDate;

    @LastModifiedBy
    @Column(name = "updated_by", length = 100)
    private String updatedBy;

    @LastModifiedDate
    @Column(name = "updated_date")
    private LocalDateTime updatedDate;

    public String getId()                        { return id; }
    public void setId(String id)                 { this.id = id; }
    public String getStatus()                    { return status; }
    public void setStatus(String status)         { this.status = status; }
    public String getComments()                  { return comments; }
    public void setComments(String comments)     { this.comments = comments; }
    public String getCreatedBy()                 { return createdBy; }
    public void setCreatedBy(String v)           { this.createdBy = v; }
    public LocalDateTime getCreatedDate()        { return createdDate; }
    public void setCreatedDate(LocalDateTime v)  { this.createdDate = v; }
    public String getUpdatedBy()                 { return updatedBy; }
    public void setUpdatedBy(String v)           { this.updatedBy = v; }
    public LocalDateTime getUpdatedDate()        { return updatedDate; }
    public void setUpdatedDate(LocalDateTime v)  { this.updatedDate = v; }
}
