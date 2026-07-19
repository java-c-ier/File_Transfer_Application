package com.trisysit.filetransfer.controller;

import com.trisysit.filetransfer.dto.OtpRequest;
import com.trisysit.filetransfer.dto.OtpVerifyRequest;
import com.trisysit.filetransfer.dto.ProfileUpdateRequest;
import com.trisysit.filetransfer.entity.User;
import com.trisysit.filetransfer.repository.UserRepository;
import com.trisysit.filetransfer.security.JwtService;
import com.trisysit.filetransfer.service.EmailService;
import com.trisysit.filetransfer.service.OtpService;
import com.trisysit.filetransfer.service.UserService;
import com.trisysit.filetransfer.util.LoginRateLimiter;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

@RestController
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private final UserRepository   userRepo;
    private final JwtService       jwtService;
    private final OtpService       otpService;
    private final EmailService     emailService;
    private final LoginRateLimiter rateLimiter;
    private final UserService      userService;

    @Value("${app.cookie-secure:false}")
    private boolean cookieSecure;

    // Small dedicated pool — keeps OTP generation + email send off the HTTP thread.
    // Response always returns the same opaque message regardless of account existence.
    private static final Executor OTP_POOL = Executors.newFixedThreadPool(4);

    public AuthController(UserRepository userRepo, JwtService jwtService,
                          OtpService otpService, EmailService emailService,
                          LoginRateLimiter rateLimiter, UserService userService) {
        this.userRepo     = userRepo;
        this.jwtService   = jwtService;
        this.otpService   = otpService;
        this.emailService = emailService;
        this.rateLimiter  = rateLimiter;
        this.userService  = userService;
    }

    // ── Step 1: user enters email ─────────────────────────────────────────────
    @PostMapping("/api/auth/login/request-otp")
    public ResponseEntity<Map<String, Object>> requestOtp(
            @RequestBody OtpRequest req, HttpServletRequest request) {

        String ip = resolveIp(request);
        log.info("[OTP_REQUEST] email={} ip={}", req.identifier(), ip);

        if (!rateLimiter.isAllowed(ip)) {
            log.warn("[OTP_REQUEST] rate_limited ip={}", ip);
            return ResponseEntity.status(429)
                    .body(Map.of("error", "Too many requests. Try again later."));
        }

        String email = req.identifier() != null ? req.identifier().trim().toLowerCase() : "";
        Optional<User> opt = userRepo.findByEmail(email);

        if (opt.isEmpty()) {
            log.warn("[OTP_REQUEST] account_not_found email={}", email);
            return ResponseEntity.status(404)
                    .body(Map.of("error", "No account found with this email address."));
        }

        User user = opt.get();
        if ("INACTIVE".equals(user.getStatus())) {
            log.warn("[OTP_REQUEST] account_inactive username={}", user.getUsername());
            return ResponseEntity.status(403)
                    .body(Map.of("error", "Account is inactive. Contact your administrator."));
        }

        CompletableFuture.runAsync(() -> {
            String code = otpService.create(user.getId());
            emailService.sendOtp(user.getEmail(), user.getFirstName(), user.getLastName(), code);
            log.info("[OTP_SENT] username={} email={}", user.getUsername(), user.getEmail());
        }, OTP_POOL);

        return ResponseEntity.ok(Map.of("message", "OTP sent to your email. It expires in 5 minutes."));
    }

    // ── Step 2: user enters OTP → issue JWT cookie ────────────────────────────
    @PostMapping("/api/auth/login/verify-otp")
    public ResponseEntity<Map<String, Object>> verifyOtp(
            @RequestBody OtpVerifyRequest req, HttpServletResponse response) {

        String email = req.identifier() != null ? req.identifier().trim().toLowerCase() : "";
        log.info("[OTP_VERIFY] email={}", email);
        Optional<User> opt = userRepo.findByEmail(email);
        if (opt.isEmpty()) {
            log.warn("[OTP_VERIFY] account_not_found email={}", email);
            return ResponseEntity.status(401).body(Map.of("error", "Invalid OTP."));
        }

        User user = opt.get();
        if ("INACTIVE".equals(user.getStatus())) {
            log.warn("[OTP_VERIFY] account_inactive username={}", user.getUsername());
            return ResponseEntity.status(403).body(Map.of("error", "Account is inactive. Contact your administrator."));
        }
        OtpService.OtpResult result = otpService.consume(user.getId(), req.otp());

        return switch (result) {
            case OK -> {
                log.info("[LOGIN_SUCCESS] username={} role={}", user.getUsername(), user.getRole());
                setAuthCookie(response, jwtService.generate(user.getUsername(), user.getRole()));
                yield ResponseEntity.ok(Map.of(
                        "success",    true,
                        "username",   user.getUsername(),
                        "role",       user.getRole(),
                        "firstName",  user.getFirstName()  != null ? user.getFirstName()  : "",
                        "lastName",   user.getLastName()   != null ? user.getLastName()   : "",
                        "email",      user.getEmail()));
            }
            case LOCKED -> {
                log.warn("[OTP_VERIFY] locked username={}", user.getUsername());
                yield ResponseEntity.status(429).body(
                        Map.of("error", "Too many failed attempts. Try again in 5 minutes."));
            }
            case EXPIRED -> {
                log.warn("[OTP_VERIFY] expired username={}", user.getUsername());
                yield ResponseEntity.status(401).body(
                        Map.of("error", "OTP has expired. Please request a new one."));
            }
            default -> {
                log.warn("[OTP_VERIFY] invalid_otp username={}", user.getUsername());
                yield ResponseEntity.status(401).body(Map.of("error", "Invalid OTP"));
            }
        };
    }

    // ── Logout ────────────────────────────────────────────────────────────────
    @PostMapping("/api/auth/logout")
    public Map<String, Object> logout(HttpServletRequest request, HttpServletResponse response) {
        String token = extractToken(request);
        if (token != null) jwtService.revoke(token);
        clearAuthCookie(response);
        log.info("[LOGOUT] completed");
        return Map.of("success", true);
    }

    // ── Whoami ────────────────────────────────────────────────────────────────
    @GetMapping("/api/auth/me")
    public Map<String, Object> me(Authentication auth) {
        if (auth == null || !auth.isAuthenticated()) return Map.of("success", false);
        String role = (auth.getDetails() instanceof String s) ? s : "USER";
        Optional<User> opt = userRepo.findByUsername(auth.getName());
        if (opt.isEmpty()) return Map.of("success", false);
        User user = opt.get();
        return Map.of("success", true, "user", Map.of(
                "username",  user.getUsername(),
                "role",      role,
                "firstName", user.getFirstName()  != null ? user.getFirstName()  : "",
                "lastName",  user.getLastName()   != null ? user.getLastName()   : "",
                "email",     user.getEmail()));
    }

    // ── Profile update (username and/or email) ────────────────────────────────
    @PutMapping("/api/user/profile")
    public ResponseEntity<Map<String, Object>> updateProfile(
            @RequestBody ProfileUpdateRequest req,
            Principal principal,
            HttpServletRequest request,
            HttpServletResponse response) {

        log.info("[PROFILE_UPDATE] username={} newUsername={} newEmail={}", principal.getName(), req.newUsername(), req.newEmail());
        Optional<User> opt = userRepo.findByUsername(principal.getName());
        if (opt.isEmpty()) {
            log.warn("[PROFILE_UPDATE] user_not_found username={}", principal.getName());
            return ResponseEntity.status(404).body(Map.of("error", "User not found"));
        }

        User user = opt.get();
        String targetName = principal.getName();

        if (req.newUsername() != null && !req.newUsername().isBlank()
                && !req.newUsername().trim().equals(principal.getName())) {
            targetName = req.newUsername().trim();
            if (userRepo.existsByUsername(targetName))
                return ResponseEntity.status(409).body(Map.of("error", "Username already taken"));
            userService.renameWorkspace(principal.getName(), targetName);
            user.setUsername(targetName);
        }

        if (req.newEmail() != null && !req.newEmail().isBlank()
                && !req.newEmail().trim().equalsIgnoreCase(user.getEmail())) {
            String targetEmail = req.newEmail().trim().toLowerCase();
            if (userRepo.existsByEmail(targetEmail))
                return ResponseEntity.status(409).body(Map.of("error", "Email already in use"));
            user.setEmail(targetEmail);
        }

        if (req.firstName() != null && !req.firstName().isBlank()) user.setFirstName(req.firstName().trim());
        if (req.lastName()  != null && !req.lastName().isBlank())  user.setLastName(req.lastName().trim());

        userRepo.save(user);
        log.info("[PROFILE_UPDATE] success username={}", user.getUsername());

        // Re-issue JWT when username changes so the new token has the correct sub
        if (!targetName.equals(principal.getName())) {
            String oldToken = extractToken(request);
            if (oldToken != null) jwtService.revoke(oldToken);
            setAuthCookie(response, jwtService.generate(user.getUsername(), user.getRole()));
        }

        return ResponseEntity.ok(Map.of(
                "success",    true,
                "username",   user.getUsername(),
                "email",      user.getEmail(),
                "firstName",  user.getFirstName() != null ? user.getFirstName() : "",
                "lastName",   user.getLastName()  != null ? user.getLastName()  : ""));
    }

    // ── Cookie helpers ────────────────────────────────────────────────────────

    private void setAuthCookie(HttpServletResponse response, String token) {
        Cookie cookie = new Cookie("auth_token", token);
        cookie.setHttpOnly(true);
        cookie.setPath("/");
        cookie.setMaxAge(24 * 60 * 60);
        cookie.setAttribute("SameSite", "Strict");
        if (cookieSecure) cookie.setSecure(true);
        response.addCookie(cookie);
    }

    private void clearAuthCookie(HttpServletResponse response) {
        Cookie cookie = new Cookie("auth_token", "");
        cookie.setHttpOnly(true);
        cookie.setPath("/");
        cookie.setMaxAge(0);
        cookie.setAttribute("SameSite", "Strict");
        response.addCookie(cookie);
    }

    private String extractToken(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie c : cookies) {
                if ("auth_token".equals(c.getName())) return c.getValue();
            }
        }
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) return header.substring(7);
        return null;
    }

    private String resolveIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        return xff != null ? xff.split(",")[0].trim() : request.getRemoteAddr();
    }
}
