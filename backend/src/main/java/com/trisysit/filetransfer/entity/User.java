package com.trisysit.filetransfer.entity;

import jakarta.persistence.*;

@Entity
@Table(name = "app_user")
public class User extends BaseEntity {

    @Column(name = "username", unique = true, nullable = false, length = 100)
    private String username;

    @Column(name = "email", unique = true, nullable = false, length = 255)
    private String email;

    @Column(name = "role", nullable = false, length = 20)
    private String role;

    @Column(name = "first_name", length = 100)
    private String firstName;

    @Column(name = "last_name", length = 100)
    private String lastName;

    public User() {}

    public User(String username, String email, String role) {
        this.username = username;
        this.email    = email;
        this.role     = role;
    }

    public String getUsername()          { return username; }
    public void setUsername(String v)    { this.username = v; }
    public String getEmail()             { return email; }
    public void setEmail(String v)       { this.email = v; }
    public String getRole()              { return role; }
    public void setRole(String v)        { this.role = v; }
    public String getFirstName()         { return firstName; }
    public void setFirstName(String v)   { this.firstName = v; }
    public String getLastName()          { return lastName; }
    public void setLastName(String v)    { this.lastName = v; }
}
