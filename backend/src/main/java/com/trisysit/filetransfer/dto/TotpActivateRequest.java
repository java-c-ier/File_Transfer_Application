package com.trisysit.filetransfer.dto;

public record TotpActivateRequest(String ticket, String code) {}
