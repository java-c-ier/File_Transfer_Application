package com.trisysit.filetransfer.dto;

public record OtpVerifyRequest(String identifier, String otp, Boolean rememberDevice) {

    public boolean remember() {
        return Boolean.TRUE.equals(rememberDevice);
    }
}
