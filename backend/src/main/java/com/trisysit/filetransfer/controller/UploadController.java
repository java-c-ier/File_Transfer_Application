package com.trisysit.filetransfer.controller;

import tools.jackson.databind.ObjectMapper;
import com.trisysit.filetransfer.service.SseService;
import com.trisysit.filetransfer.service.StatsService;
import com.trisysit.filetransfer.util.PathUtils;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.*;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.nio.channels.Channels;
import java.nio.channels.FileChannel;
import java.nio.channels.ReadableByteChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.Principal;
import java.util.*;

@RestController
public class UploadController {

    private static final Logger log = LoggerFactory.getLogger(UploadController.class);

    private final Path uploadDir;
    private final SseService sseService;
    private final StatsService statsService;
    private final long maxFileSizeBytes;
    private final Path chunksTmpDir;
    private final ObjectMapper mapper = new ObjectMapper();

    public UploadController(Path uploadDir, SseService sseService, StatsService statsService,
                            @Value("${app.max-file-size-mb:500}") long maxFileSizeMb) throws IOException {
        this.uploadDir        = uploadDir;
        this.sseService       = sseService;
        this.statsService     = statsService;
        this.maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;
        this.chunksTmpDir     = uploadDir.resolve(".chunks");
        Files.createDirectories(chunksTmpDir);
        cleanOrphanedChunks();
    }

    // ---------------------------------------------------------------------------
    // Legacy multipart upload (kept for compatibility)
    // ---------------------------------------------------------------------------
    @PostMapping("/api/upload")
    public ResponseEntity<Map<String, Object>> upload(
            @RequestParam("files") List<MultipartFile> files,
            @RequestHeader(value = "X-Upload-Path", defaultValue = "") String subfolder,
            Principal principal) throws IOException {

        if (files == null || files.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "No files uploaded"));
        }

        Path userRoot = PathUtils.userDir(uploadDir, principal.getName());
        Path destBase = PathUtils.safePath(userRoot, subfolder);
        if (destBase == null) return ResponseEntity.badRequest().body(Map.of("error", "Invalid upload path"));
        Files.createDirectories(destBase);

        List<Map<String, Object>> uploaded = new ArrayList<>();
        for (MultipartFile file : files) {
            String safeName = PathUtils.sanitizeFilename(file.getOriginalFilename());
            Path dest = destBase.resolve(safeName);
            file.transferTo(dest);
            uploaded.add(Map.of("name", safeName, "size", file.getSize()));
        }

        statsService.invalidate(principal.getName());
        sseService.broadcast("upload");
        log.info("[UPLOAD] multipart username={} files={} path={}", principal.getName(), uploaded.size(), subfolder);
        return ResponseEntity.ok(Map.of("success", true, "files", uploaded));
    }

    // ---------------------------------------------------------------------------
    // Streaming upload — single raw octet-stream POST per file
    // ---------------------------------------------------------------------------
    @PostMapping(value = "/api/upload-stream", consumes = "application/octet-stream")
    public ResponseEntity<Map<String, Object>> uploadStream(HttpServletRequest request,
                                                            Principal principal) throws IOException {

        String fileName  = request.getHeader("X-File-Name");
        String subfolder = Optional.ofNullable(request.getHeader("X-Upload-Path")).orElse("");
        long byteOffset  = parseLong(request.getHeader("X-Byte-Offset"), 0L);
        long fileSize    = parseLong(request.getHeader("X-File-Size"), 0L);

        if (fileName == null) return ResponseEntity.badRequest().body(Map.of("error", "Missing X-File-Name header"));

        Path userRoot = PathUtils.userDir(uploadDir, principal.getName());
        Path destBase = PathUtils.safePath(userRoot, subfolder);
        if (destBase == null) return ResponseEntity.badRequest().body(Map.of("error", "Invalid upload path"));

        if (fileSize > maxFileSizeBytes || byteOffset > maxFileSizeBytes) {
            return ResponseEntity.status(413).body(Map.of("error", "File exceeds maximum allowed size"));
        }

        Files.createDirectories(destBase);
        String safeName  = PathUtils.sanitizeFilename(URLDecoder.decode(fileName, StandardCharsets.UTF_8));
        Path finalPath   = destBase.resolve(safeName);
        Path stagingPath = destBase.resolve(safeName + ".uploading");

        OpenOption[] opts = byteOffset == 0
                ? new OpenOption[]{StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE}
                : new OpenOption[]{StandardOpenOption.WRITE};

        try (FileChannel channel = FileChannel.open(stagingPath, opts)) {
            channel.position(byteOffset);
            ReadableByteChannel src = Channels.newChannel(request.getInputStream());
            ByteBuffer buf = ByteBuffer.allocate(64 * 1024);
            long bytesWritten = byteOffset;

            while (src.read(buf) != -1) {
                buf.flip();
                bytesWritten += buf.remaining();
                if (bytesWritten > maxFileSizeBytes) {
                    return ResponseEntity.status(413).body(Map.of("error", "File exceeds maximum allowed size"));
                }
                channel.write(buf);
                buf.clear();
            }
        } catch (IOException e) {
            // Client disconnected mid-stream (pause) — staging file has partial data
            if (request.isAsyncStarted() || e.getMessage() == null ||
                    e.getMessage().contains("reset") || e.getMessage().contains("aborted") ||
                    e.getMessage().contains("Broken pipe")) {
                return null; // connection dead — cannot send response
            }
            throw e;
        }

        long stagingSize = 0;
        try { stagingSize = Files.size(stagingPath); } catch (IOException ignored) {}

        boolean isComplete = fileSize == 0 ? byteOffset == 0 : stagingSize >= fileSize;

        if (isComplete) {
            Files.move(stagingPath, finalPath, StandardCopyOption.REPLACE_EXISTING);
            statsService.invalidate(principal.getName());
            sseService.broadcast("upload");
            log.info("[UPLOAD] stream_complete username={} file={} size={}", principal.getName(), safeName, Files.size(finalPath));
            return ResponseEntity.ok(Map.of("done", true, "name", safeName, "size", Files.size(finalPath)));
        }

        return ResponseEntity.ok(Map.of("done", false, "bytesReceived", stagingSize));
    }

    // Bytes already written to staging file — resume offset for the client
    @GetMapping("/api/upload-stream/status")
    public ResponseEntity<Map<String, Object>> streamStatus(@RequestParam String fileName,
                                                             @RequestParam(required = false) String path,
                                                             Principal principal) throws IOException {
        String subfolder = Optional.ofNullable(path).orElse("");
        Path userRoot = PathUtils.userDir(uploadDir, principal.getName());
        Path destBase = PathUtils.safePath(userRoot, subfolder);
        if (destBase == null) return ResponseEntity.badRequest().body(Map.of("error", "Invalid path"));

        String safeName  = PathUtils.sanitizeFilename(fileName);
        Path stagingPath = destBase.resolve(safeName + ".uploading");

        long bytesReceived = 0;
        try { bytesReceived = Files.size(stagingPath); } catch (IOException ignored) {}

        return ResponseEntity.ok(Map.of("bytesReceived", bytesReceived));
    }

    // ---------------------------------------------------------------------------
    // Chunked upload — raw octet-stream, metadata in headers, byte-offset writes
    // ---------------------------------------------------------------------------
    @PostMapping(value = "/api/upload-chunk", consumes = "application/octet-stream")
    public ResponseEntity<Map<String, Object>> uploadChunk(HttpServletRequest request,
                                                           Principal principal) throws IOException {

        String uploadId    = request.getHeader("X-Upload-Id");
        String chunkIndex  = request.getHeader("X-Chunk-Index");
        String totalChunks = request.getHeader("X-Total-Chunks");
        String fileName    = request.getHeader("X-File-Name");
        String byteOffsetH = request.getHeader("X-Byte-Offset");
        String fileSizeH   = request.getHeader("X-File-Size");
        String subfolder   = Optional.ofNullable(request.getHeader("X-Upload-Path")).orElse("");

        if (uploadId == null || chunkIndex == null || totalChunks == null || fileName == null || byteOffsetH == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Missing required headers"));
        }

        Path userRoot = PathUtils.userDir(uploadDir, principal.getName());
        Path destBase = PathUtils.safePath(userRoot, subfolder);
        if (destBase == null) return ResponseEntity.badRequest().body(Map.of("error", "Invalid upload path"));

        int  totalChunksNum = Integer.parseInt(totalChunks);
        int  chunkIndexNum  = Integer.parseInt(chunkIndex);
        long byteOffset     = Long.parseLong(byteOffsetH);
        long fileSize       = parseLong(fileSizeH, 0L);

        if (chunkIndexNum < 0 || chunkIndexNum >= totalChunksNum || totalChunksNum > 10_000 || byteOffset < 0) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid chunk parameters"));
        }
        if (fileSize > maxFileSizeBytes || byteOffset > maxFileSizeBytes) {
            return ResponseEntity.status(413).body(Map.of("error", "File exceeds maximum allowed size"));
        }

        String safeUploadId = uploadId.replaceAll("[^a-zA-Z0-9\\-_]", "");
        Path metaDir  = chunksTmpDir.resolve(safeUploadId);
        Path metaPath = metaDir.resolve("meta.json");
        Files.createDirectories(metaDir);
        Files.createDirectories(destBase);

        String safeName  = PathUtils.sanitizeFilename(URLDecoder.decode(fileName, StandardCharsets.UTF_8));
        Path finalPath   = destBase.resolve(safeName);
        Path stagingPath = destBase.resolve(safeName + ".uploading");

        // Create sparse staging file on first chunk
        if (!Files.exists(stagingPath)) {
            try (RandomAccessFile raf = new RandomAccessFile(stagingPath.toFile(), "rw")) {
                if (fileSize > 0 && fileSize <= maxFileSizeBytes) raf.setLength(fileSize);
            }
        }

        // Write chunk at correct byte offset
        try (FileChannel channel = FileChannel.open(stagingPath, StandardOpenOption.WRITE)) {
            channel.position(byteOffset);
            ReadableByteChannel src = Channels.newChannel(request.getInputStream());
            ByteBuffer buf = ByteBuffer.allocate(64 * 1024);
            while (src.read(buf) != -1) {
                buf.flip();
                channel.write(buf);
                buf.clear();
            }
        }

        // Update chunk metadata — subfolder stored relative to uploadDir so cancelChunk can reconstruct the path
        ChunkMeta meta;
        try {
            meta = mapper.readValue(metaPath.toFile(), ChunkMeta.class);
        } catch (Exception e) {
            meta = new ChunkMeta(
                    uploadDir.relativize(destBase).toString(),
                    safeName, totalChunksNum, new ArrayList<>());
        }
        if (!meta.received.contains(chunkIndexNum)) meta.received.add(chunkIndexNum);
        mapper.writeValue(metaPath.toFile(), meta);

        boolean isComplete = meta.received.size() == totalChunksNum;
        if (isComplete) {
            Files.move(stagingPath, finalPath, StandardCopyOption.REPLACE_EXISTING);
            deleteRecursive(metaDir);
            statsService.invalidate(principal.getName());
            sseService.broadcast("upload");
            log.info("[UPLOAD] chunk_complete username={} file={} size={}", principal.getName(), safeName, Files.size(finalPath));
            return ResponseEntity.ok(Map.of("done", true, "name", safeName, "size", Files.size(finalPath)));
        }

        return ResponseEntity.ok(Map.of("done", false, "received", meta.received.size(), "total", totalChunksNum));
    }

    @GetMapping("/api/upload-chunk/status")
    public ResponseEntity<Map<String, Object>> chunkStatus(@RequestParam String uploadId) {
        String safeId = uploadId.replaceAll("[^a-zA-Z0-9\\-_]", "");
        Path metaPath = chunksTmpDir.resolve(safeId).resolve("meta.json");
        try {
            ChunkMeta meta = mapper.readValue(metaPath.toFile(), ChunkMeta.class);
            List<Integer> sorted = meta.received.stream().sorted().toList();
            return ResponseEntity.ok(Map.of("received", sorted));
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("received", List.of()));
        }
    }

    @DeleteMapping("/api/upload-chunk")
    public ResponseEntity<Map<String, Object>> cancelChunk(@RequestParam String uploadId) {
        String safeId = uploadId.replaceAll("[^a-zA-Z0-9\\-_]", "");
        Path metaDir  = chunksTmpDir.resolve(safeId);
        try {
            Path metaPath = metaDir.resolve("meta.json");
            if (Files.exists(metaPath)) {
                ChunkMeta meta = mapper.readValue(metaPath.toFile(), ChunkMeta.class);
                // sanitizedSubfolder is relative to uploadDir (includes username prefix)
                Path destBase = PathUtils.safePath(uploadDir, meta.sanitizedSubfolder);
                if (destBase != null) {
                    Path staging = destBase.resolve(meta.sanitizedFileName + ".uploading");
                    Files.deleteIfExists(staging);
                }
            }
            deleteRecursive(metaDir);
        } catch (Exception ignored) {}
        return ResponseEntity.ok(Map.of("success", true));
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private static long parseLong(String s, long fallback) {
        if (s == null) return fallback;
        try { return Long.parseLong(s); } catch (NumberFormatException e) { return fallback; }
    }

    private void deleteRecursive(Path path) throws IOException {
        if (!Files.exists(path)) return;
        Files.walk(path)
             .sorted(Comparator.reverseOrder())
             .forEach(p -> { try { Files.delete(p); } catch (IOException ignored) {} });
    }

    private void cleanOrphanedChunks() {
        long cutoff = System.currentTimeMillis() - 24L * 60 * 60 * 1000;
        try (var dirs = Files.newDirectoryStream(chunksTmpDir)) {
            for (Path dir : dirs) {
                try {
                    if (Files.getLastModifiedTime(dir).toMillis() < cutoff) {
                        deleteRecursive(dir);
                    }
                } catch (IOException ignored) {}
            }
        } catch (IOException ignored) {}
    }

    // JSON model for chunk metadata
    static class ChunkMeta {
        public String sanitizedSubfolder;
        public String sanitizedFileName;
        public int totalChunks;
        public List<Integer> received;

        public ChunkMeta() {}
        public ChunkMeta(String sub, String name, int total, List<Integer> received) {
            this.sanitizedSubfolder = sub;
            this.sanitizedFileName  = name;
            this.totalChunks        = total;
            this.received           = received;
        }
    }
}
