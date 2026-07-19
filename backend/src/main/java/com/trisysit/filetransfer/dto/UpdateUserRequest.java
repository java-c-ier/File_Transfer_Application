package com.trisysit.filetransfer.dto;

public record UpdateUserRequest(String oldUsername, String newUsername, String newEmail, String role, String firstName, String lastName, String status) {}
