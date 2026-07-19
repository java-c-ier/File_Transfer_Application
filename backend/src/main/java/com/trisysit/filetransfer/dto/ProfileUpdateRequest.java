package com.trisysit.filetransfer.dto;

public record ProfileUpdateRequest(String newUsername, String newEmail, String firstName, String lastName) {}
