package com.trisysit.filetransfer.dto;

public record CreateUserRequest(String username, String email, String role, String firstName, String lastName) {}
