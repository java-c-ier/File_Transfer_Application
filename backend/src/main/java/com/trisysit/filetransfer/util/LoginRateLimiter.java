package com.trisysit.filetransfer.util;

import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Simple in-memory per-IP rate limiter for the login endpoint.
 * Allows at most MAX_ATTEMPTS within WINDOW_MS per IP address.
 */
@Component
public class LoginRateLimiter {

    private static final int  MAX_ATTEMPTS = 20;
    private static final long WINDOW_MS    = 15 * 60 * 1000L; // 15 minutes

    private final Map<String, Deque<Long>> attempts = new ConcurrentHashMap<>();

    public boolean isAllowed(String ip) {
        long now = System.currentTimeMillis();
        Deque<Long> timestamps = attempts.computeIfAbsent(ip, k -> new ArrayDeque<>());

        synchronized (timestamps) {
            // Drop timestamps outside the window
            while (!timestamps.isEmpty() && now - timestamps.peekFirst() > WINDOW_MS) {
                timestamps.pollFirst();
            }
            if (timestamps.size() >= MAX_ATTEMPTS) return false;
            timestamps.addLast(now);
            return true;
        }
    }
}
