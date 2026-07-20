package com.trisysit.filetransfer.controller;

import com.trisysit.filetransfer.service.FileService;
import com.trisysit.filetransfer.service.StatsService;
import com.trisysit.filetransfer.util.PathUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.Principal;
import java.util.Map;

@RestController
public class FileController {

    private static final Logger log = LoggerFactory.getLogger(FileController.class);

    private final FileService fileService;
    private final StatsService statsService;
    private final Path uploadDir;

    public FileController(FileService fileService, StatsService statsService, Path uploadDir) {
        this.fileService  = fileService;
        this.statsService = statsService;
        this.uploadDir    = uploadDir;
    }

    @GetMapping("/api/files")
    public ResponseEntity<Map<String, Object>> listFiles(
            @RequestParam(required = false) String path,
            @RequestParam(required = false, defaultValue = "100") int limit,
            @RequestParam(required = false, defaultValue = "0")   int offset,
            Principal principal) throws IOException {
        log.info("[FILE] list username={} path={} limit={} offset={}", principal.getName(), path, limit, offset);
        return ResponseEntity.ok(fileService.listFiles(principal.getName(), path, limit, offset));
    }

    @PostMapping("/api/folder")
    public ResponseEntity<Map<String, Object>> createFolder(@RequestBody Map<String, String> body,
                                                            Principal principal) throws IOException {
        log.info("[FILE] create_folder username={} name={} parent={}", principal.getName(), body.get("name"), body.get("parentPath"));
        Map<String, Object> result = fileService.createFolder(principal.getName(), body.get("name"), body.get("parentPath"));
        if (result.containsKey("error")) {
            log.warn("[FILE] create_folder_failed username={} error={}", principal.getName(), result.get("error"));
            return ResponseEntity.status(409).body(result);
        }
        log.info("[FILE] create_folder_success username={} name={}", principal.getName(), body.get("name"));
        return ResponseEntity.ok(result);
    }

    @DeleteMapping("/api/files")
    public ResponseEntity<Map<String, Object>> delete(@RequestParam String path,
                                                      Principal principal) throws IOException {
        log.info("[FILE] delete username={} path={}", principal.getName(), path);
        Map<String, Object> result = fileService.delete(principal.getName(), path);
        if (result.containsKey("error")) {
            log.warn("[FILE] delete_failed username={} path={} error={}", principal.getName(), path, result.get("error"));
            return ResponseEntity.status(404).body(result);
        }
        log.info("[FILE] delete_success username={} path={}", principal.getName(), path);
        return ResponseEntity.ok(result);
    }

    @PutMapping("/api/files")
    public ResponseEntity<Map<String, Object>> rename(@RequestBody Map<String, String> body,
                                                      Principal principal) throws IOException {
        log.info("[FILE] rename username={} oldPath={} newName={}", principal.getName(), body.get("oldPath"), body.get("newName"));
        Map<String, Object> result = fileService.rename(principal.getName(), body.get("oldPath"), body.get("newName"));
        if (result.containsKey("error")) {
            log.warn("[FILE] rename_failed username={} error={}", principal.getName(), result.get("error"));
            return ResponseEntity.status(404).body(result);
        }
        log.info("[FILE] rename_success username={} newName={}", principal.getName(), body.get("newName"));
        return ResponseEntity.ok(result);
    }

    @GetMapping("/api/text")
    public Map<String, String> getText(Principal principal) {
        log.info("[FILE] read_text username={}", principal.getName());
        return Map.of("text", fileService.readText(principal.getName()));
    }

    @PostMapping("/api/text")
    public Map<String, Object> saveText(@RequestBody Map<String, String> body, Principal principal) {
        log.info("[FILE] save_text username={}", principal.getName());
        fileService.writeText(principal.getName(), body.get("text"));
        return Map.of("success", true);
    }

    @GetMapping("/api/stats")
    public Map<String, Object> stats(Principal principal) throws IOException {
        return statsService.getStats(principal.getName());
    }

    @GetMapping("/api/files/check")
    public ResponseEntity<Map<String, Object>> checkFile(
            @RequestParam String name,
            @RequestParam long size,
            @RequestParam(required = false, defaultValue = "") String path,
            @RequestParam(required = false) String hash,
            Principal principal) throws IOException {
        Path userRoot = PathUtils.userDir(uploadDir, principal.getName());
        Path dir      = PathUtils.safePath(userRoot, path);
        if (dir == null) return ResponseEntity.badRequest().body(Map.of("error", "Invalid path"));
        Path file = dir.resolve(PathUtils.sanitizeFilename(name));
        if (!Files.exists(file) || Files.isDirectory(file))
            return ResponseEntity.ok(Map.of("exists", false));
        long existingSize = Files.size(file);
        if (existingSize != size)
            return ResponseEntity.ok(Map.of("exists", true, "sameSize", false, "duplicate", false));
        if (hash == null || hash.isBlank())
            return ResponseEntity.ok(Map.of("exists", true, "sameSize", true, "duplicate", false));
        boolean duplicate = hash.equals(sha256(file));
        return ResponseEntity.ok(Map.of("exists", true, "sameSize", true, "duplicate", duplicate));
    }

    private String sha256(Path file) throws IOException {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (InputStream is = Files.newInputStream(file)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = is.read(buf)) != -1) md.update(buf, 0, n);
            }
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest()) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException(e);
        }
    }

    @GetMapping("/api/health")
    public Map<String, Object> health() {
        return Map.of("status", "ok", "uptime", ProcessHandle.current().info().totalCpuDuration()
                .map(d -> d.getSeconds()).orElse(0L));
    }
}
