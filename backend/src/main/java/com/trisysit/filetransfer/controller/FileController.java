package com.trisysit.filetransfer.controller;

import com.trisysit.filetransfer.service.FileService;
import com.trisysit.filetransfer.service.StatsService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.security.Principal;
import java.util.Map;

@RestController
public class FileController {

    private static final Logger log = LoggerFactory.getLogger(FileController.class);

    private final FileService fileService;
    private final StatsService statsService;

    public FileController(FileService fileService, StatsService statsService) {
        this.fileService  = fileService;
        this.statsService = statsService;
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

    @GetMapping("/api/health")
    public Map<String, Object> health() {
        return Map.of("status", "ok", "uptime", ProcessHandle.current().info().totalCpuDuration()
                .map(d -> d.getSeconds()).orElse(0L));
    }
}
