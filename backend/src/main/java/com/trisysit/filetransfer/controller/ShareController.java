package com.trisysit.filetransfer.controller;

import com.trisysit.filetransfer.entity.FileShare;
import com.trisysit.filetransfer.entity.FileShareToken;
import com.trisysit.filetransfer.repository.FileShareRepository;
import com.trisysit.filetransfer.repository.FileShareTokenRepository;
import com.trisysit.filetransfer.util.PathUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.Principal;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;

@RestController
public class ShareController {

    private static final Logger log = LoggerFactory.getLogger(ShareController.class);

    private static final String TOKEN_CHARS  = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int    TOKEN_LEN    = 6;
    private static final long   EXPIRY_HOURS = 24;

    private final FileShareRepository      shareRepo;
    private final FileShareTokenRepository tokenRepo;
    private final Path uploadDir;

    public ShareController(FileShareRepository shareRepo, FileShareTokenRepository tokenRepo, Path uploadDir) {
        this.shareRepo  = shareRepo;
        this.tokenRepo  = tokenRepo;
        this.uploadDir  = uploadDir;
    }

    /**
     * Create (or refresh) a share link for a file and issue a new one-time token.
     * Authenticated endpoint — only the file owner can call this.
     * Same file within 24 h always returns the same shareId (stable URL).
     */
    @PostMapping("/api/share")
    public ResponseEntity<Map<String, Object>> createShare(
            @RequestBody Map<String, String> body,
            Principal principal) throws IOException {

        String filePath = body.get("path");
        if (filePath == null || filePath.isBlank())
            return ResponseEntity.badRequest().body(Map.of("error", "path required"));

        Path userRoot = PathUtils.userDir(uploadDir, principal.getName());
        Path target   = PathUtils.safePath(userRoot, filePath);
        if (target == null || !Files.exists(target) || Files.isDirectory(target))
            return ResponseEntity.badRequest().body(Map.of("error", "File not found"));

        String fileName = target.getFileName().toString();
        Instant newExpiry = Instant.now().plusSeconds(EXPIRY_HOURS * 3600);

        // Reuse existing active share for this file, or create a new one
        Optional<FileShare> existing = shareRepo.findByOwnerUsernameAndFilePath(principal.getName(), filePath);
        FileShare share;
        if (existing.isPresent() && Instant.now().isBefore(existing.get().getExpiresAt())) {
            share = existing.get();
            share.setExpiresAt(newExpiry); // refresh to 24 h from now
            share.setFileName(fileName);   // update if file was renamed
        } else {
            share = new FileShare();
            share.setFilePath(filePath);
            share.setFileName(fileName);
            share.setOwnerUsername(principal.getName());
            share.setExpiresAt(newExpiry);
        }
        shareRepo.save(share);

        // Always issue a fresh one-time token
        FileShareToken tok = new FileShareToken();
        tok.setShareId(share.getId());
        tok.setToken(generateToken());
        tokenRepo.save(tok);

        log.info("[SHARE] token issued shareId={} file={} by={}", share.getId(), filePath, principal.getName());
        return ResponseEntity.ok(Map.of(
            "shareId",   share.getId(),
            "token",     tok.getToken(),
            "fileName",  fileName,
            "expiresIn", EXPIRY_HOURS + "h"
        ));
    }

    /** Get share info — public, no auth. */
    @GetMapping("/api/share/{id}")
    public ResponseEntity<Map<String, Object>> shareInfo(@PathVariable String id) throws IOException {
        FileShare share = shareRepo.findById(id).orElse(null);
        if (share == null)
            return ResponseEntity.status(404).body(Map.of("error", "Share not found"));
        if (Instant.now().isAfter(share.getExpiresAt()))
            return ResponseEntity.status(410).body(Map.of("error", "This link has expired"));

        Path userRoot = PathUtils.userDir(uploadDir, share.getOwnerUsername());
        Path target   = PathUtils.safePath(userRoot, share.getFilePath());
        if (target == null || !Files.exists(target))
            return ResponseEntity.status(410).body(Map.of("error", "The file has been deleted by the owner"));

        return ResponseEntity.ok(Map.of(
            "fileName",  share.getFileName(),
            "expiresAt", share.getExpiresAt().toString()
        ));
    }

    /** Download using a one-time token — public, no auth. */
    @GetMapping("/api/share/{id}/download")
    public ResponseEntity<?> download(@PathVariable String id, @RequestParam String token) throws IOException {
        FileShare share = shareRepo.findById(id).orElse(null);
        if (share == null)
            return ResponseEntity.status(404).body(Map.of("error", "Share not found"));
        if (Instant.now().isAfter(share.getExpiresAt()))
            return ResponseEntity.status(410).body(Map.of("error", "This link has expired"));

        FileShareToken tok = tokenRepo
            .findByShareIdAndTokenIgnoreCaseAndUsedFalse(id, token.trim())
            .orElse(null);
        if (tok == null)
            return ResponseEntity.status(401).body(Map.of("error", "Invalid or already-used token"));

        Path userRoot = PathUtils.userDir(uploadDir, share.getOwnerUsername());
        Path target   = PathUtils.safePath(userRoot, share.getFilePath());
        if (target == null || !Files.exists(target))
            return ResponseEntity.status(404).body(Map.of("error", "File no longer exists"));

        tok.setUsed(true);
        tokenRepo.save(tok);
        log.info("[SHARE] download shareId={} file={}", id, share.getFilePath());

        String encoded = URLEncoder.encode(share.getFileName(), StandardCharsets.UTF_8)
                                   .replace("+", "%20");
        InputStream is = Files.newInputStream(target);
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename*=UTF-8''" + encoded)
            .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_OCTET_STREAM_VALUE)
            .header(HttpHeaders.CONTENT_LENGTH, String.valueOf(Files.size(target)))
            .body(new InputStreamResource(is));
    }

    private String generateToken() {
        SecureRandom rng = new SecureRandom();
        StringBuilder sb = new StringBuilder(TOKEN_LEN);
        for (int i = 0; i < TOKEN_LEN; i++)
            sb.append(TOKEN_CHARS.charAt(rng.nextInt(TOKEN_CHARS.length())));
        return sb.toString();
    }
}
