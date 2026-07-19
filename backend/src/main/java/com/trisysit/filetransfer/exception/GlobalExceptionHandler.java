package com.trisysit.filetransfer.exception;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, String>> handleStatus(ResponseStatusException e) {
        log.warn("[EXCEPTION] ResponseStatusException status={} reason={}", e.getStatusCode(), e.getReason());
        return ResponseEntity.status(e.getStatusCode())
                .body(Map.of("error", e.getReason() != null ? e.getReason() : e.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> handleIllegalArg(IllegalArgumentException e) {
        log.warn("[EXCEPTION] IllegalArgumentException message={}", e.getMessage());
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(IOException.class)
    public ResponseEntity<Map<String, String>> handleIO(IOException e) {
        log.error("[EXCEPTION] IOException message={}", e.getMessage(), e);
        return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleGeneral(Exception e) {
        log.error("[EXCEPTION] Unhandled exception type={} message={}", e.getClass().getSimpleName(), e.getMessage(), e);
        return ResponseEntity.internalServerError().body(Map.of("error", "An unexpected error occurred"));
    }
}
