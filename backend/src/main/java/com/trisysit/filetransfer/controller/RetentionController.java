package com.trisysit.filetransfer.controller;

import com.trisysit.filetransfer.dto.KeepRequest;
import com.trisysit.filetransfer.service.RetentionHoldService;
import com.trisysit.filetransfer.service.SseService;
import com.trisysit.filetransfer.util.PathUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.Principal;
import java.util.Map;

/** Lives under /api/admin, so SecurityConfig already limits it to admins. */
@RestController
@RequestMapping("/api/admin/retention")
public class RetentionController {

    private static final Logger log = LoggerFactory.getLogger(RetentionController.class);

    private final Path uploadDir;
    private final RetentionHoldService holds;
    private final SseService sseService;

    public RetentionController(Path uploadDir, RetentionHoldService holds, SseService sseService) {
        this.uploadDir  = uploadDir;
        this.holds      = holds;
        this.sseService = sseService;
    }

    /** Keep (or stop keeping) one of the admin's own files or folders past the retention period. */
    @PutMapping("/keep")
    public ResponseEntity<Map<String, Object>> keep(@RequestBody KeepRequest req, Principal principal)
            throws IOException {

        if (req.path() == null || req.path().isBlank() || req.keep() == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "path and keep are required"));
        }

        Path userRoot = PathUtils.userDir(uploadDir, principal.getName());
        Path target   = PathUtils.safePath(userRoot, req.path());
        if (target == null || target.equals(userRoot)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid path"));
        }
        if (!Files.exists(target)) {
            return ResponseEntity.status(404).body(Map.of("error", "File not found"));
        }

        String rel = userRoot.relativize(target).toString().replace(File.separatorChar, '/');
        holds.setKept(PathUtils.dirName(principal.getName()), rel, req.keep());
        sseService.broadcast(principal.getName(), "keep");
        log.info("[RETENTION] keep={} username={} path={}", req.keep(), principal.getName(), rel);
        return ResponseEntity.ok(Map.of("success", true, "kept", req.keep()));
    }
}
