package com.trisysit.filetransfer.controller;

import com.trisysit.filetransfer.service.SseService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
public class SseController {

    private final SseService sseService;

    public SseController(SseService sseService) {
        this.sseService = sseService;
    }

    // Token authentication is handled by JwtAuthFilter (reads from ?token= query param).
    // Spring Security permits this URL; the filter validates and populates the SecurityContext.
    @GetMapping("/api/events")
    public SseEmitter subscribe() {
        return sseService.subscribe();
    }
}
