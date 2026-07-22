package com.trisysit.filetransfer.controller;

import com.trisysit.filetransfer.util.PathUtils;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.io.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.Principal;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.springframework.http.HttpStatus.*;

@RestController
public class DownloadController {

    private final Path uploadDir;

    public DownloadController(Path uploadDir) {
        this.uploadDir = uploadDir;
    }

    // ---------------------------------------------------------------------------
    // Single file download with HTTP Range / resume support
    // ---------------------------------------------------------------------------
    @GetMapping("/api/download")
    public void download(@RequestParam String path,
                         @RequestHeader(value = "Range", required = false) String range,
                         HttpServletResponse response,
                         Principal principal) throws IOException {

        Path userRoot = PathUtils.userDir(uploadDir, principal.getName());
        Path fullPath = PathUtils.safePath(userRoot, path);
        if (fullPath == null) throw new ResponseStatusException(BAD_REQUEST, "Invalid path");
        if (!Files.exists(fullPath) || Files.isDirectory(fullPath)) {
            throw new ResponseStatusException(NOT_FOUND, "File not found");
        }

        long fileSize = Files.size(fullPath);
        String fileName = fullPath.getFileName().toString();
        String encoded  = URLEncoder.encode(fileName, StandardCharsets.UTF_8).replace("+", "%20");

        response.setHeader("Accept-Ranges", "bytes");
        response.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encoded);

        if (range != null) {
            long[] bounds = parseRange(range, fileSize);
            if (bounds == null) {
                response.setHeader("Content-Range", "bytes */" + fileSize);
                response.setStatus(416);
                return;
            }
            long start  = bounds[0];
            long end    = bounds[1];
            long length = end - start + 1;

            response.setStatus(206);
            response.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + fileSize);
            response.setContentLengthLong(length);
            response.setContentType("application/octet-stream");

            try (InputStream is = Files.newInputStream(fullPath)) {
                is.skipNBytes(start);
                pipe(is, response.getOutputStream(), length);
            }
        } else {
            response.setStatus(200);
            response.setContentLengthLong(fileSize);
            response.setContentType("application/octet-stream");
            try (InputStream is = Files.newInputStream(fullPath)) {
                pipe(is, response.getOutputStream(), fileSize);
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Preview — serve file inline with correct Content-Type for browser rendering
    // ---------------------------------------------------------------------------
    private static final Map<String, String> MIME_MAP = Map.ofEntries(
        Map.entry("jpg",   "image/jpeg"),    Map.entry("jpeg",  "image/jpeg"),
        Map.entry("png",   "image/png"),     Map.entry("gif",   "image/gif"),
        Map.entry("svg",   "image/svg+xml"), Map.entry("webp",  "image/webp"),
        Map.entry("mp4",   "video/mp4"),     Map.entry("webm",  "video/webm"),
        Map.entry("mov",   "video/quicktime"),Map.entry("mkv",  "video/x-matroska"),
        Map.entry("mp3",   "audio/mpeg"),    Map.entry("wav",   "audio/wav"),
        Map.entry("ogg",   "audio/ogg"),
        Map.entry("pdf",   "application/pdf"),
        Map.entry("xlsx",  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        Map.entry("xls",   "application/vnd.ms-excel"),
        Map.entry("docx",  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        Map.entry("doc",   "application/msword"),
        Map.entry("txt",   "text/plain"),    Map.entry("log",   "text/plain"),
        Map.entry("csv",   "text/plain"),    Map.entry("json",  "application/json"),
        Map.entry("xml",   "text/xml"),      Map.entry("html",  "text/html"),
        Map.entry("css",   "text/css"),      Map.entry("js",    "text/javascript"),
        Map.entry("jsx",   "text/javascript"),Map.entry("ts",   "text/plain"),
        Map.entry("tsx",   "text/plain"),    Map.entry("py",    "text/plain"),
        Map.entry("java",  "text/plain"),    Map.entry("sh",    "text/plain"),
        Map.entry("bat",   "text/plain"),    Map.entry("sql",   "text/plain"),
        Map.entry("md",    "text/plain"),    Map.entry("yml",   "text/plain"),
        Map.entry("yaml",  "text/plain"),    Map.entry("conf",  "text/plain"),
        Map.entry("properties", "text/plain")
    );

    @GetMapping("/api/preview")
    public void preview(@RequestParam String path,
                        HttpServletResponse response,
                        Principal principal) throws IOException {

        Path userRoot = PathUtils.userDir(uploadDir, principal.getName());
        Path fullPath = PathUtils.safePath(userRoot, path);
        if (fullPath == null) throw new ResponseStatusException(BAD_REQUEST, "Invalid path");
        if (!Files.exists(fullPath) || Files.isDirectory(fullPath)) {
            throw new ResponseStatusException(NOT_FOUND, "File not found");
        }

        long fileSize = Files.size(fullPath);
        if (fileSize > 50L * 1024 * 1024) {
            throw new ResponseStatusException(PAYLOAD_TOO_LARGE, "File too large to preview (max 50 MB)");
        }

        String ext  = fullPath.getFileName().toString();
        int    dot  = ext.lastIndexOf('.');
        String mime = dot >= 0 ? MIME_MAP.getOrDefault(ext.substring(dot + 1).toLowerCase(), null) : null;
        if (mime == null) {
            try { mime = Files.probeContentType(fullPath); } catch (IOException ignored) {}
        }
        if (mime == null) mime = "application/octet-stream";

        String encoded = URLEncoder.encode(fullPath.getFileName().toString(), StandardCharsets.UTF_8).replace("+", "%20");
        response.setContentType(mime);
        response.setContentLengthLong(fileSize);
        response.setHeader("Content-Disposition", "inline; filename*=UTF-8''" + encoded);

        try (InputStream is = Files.newInputStream(fullPath)) {
            is.transferTo(response.getOutputStream());
        }
    }

    // ---------------------------------------------------------------------------
    // Folder download as streaming ZIP (level 1 — fast, not maximum compression)
    // ---------------------------------------------------------------------------
    @GetMapping("/api/download-zip")
    public void downloadZip(@RequestParam String path,
                            HttpServletResponse response,
                            Principal principal) throws IOException {

        Path userRoot = PathUtils.userDir(uploadDir, principal.getName());
        Path fullPath = PathUtils.safePath(userRoot, path);
        if (fullPath == null) throw new ResponseStatusException(BAD_REQUEST, "Invalid path");
        if (!Files.exists(fullPath) || !Files.isDirectory(fullPath)) {
            throw new ResponseStatusException(NOT_FOUND, "Folder not found");
        }

        String folderName = fullPath.getFileName().toString();
        String encoded    = URLEncoder.encode(folderName, StandardCharsets.UTF_8).replace("+", "%20");

        response.setContentType("application/zip");
        response.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encoded + ".zip");
        response.setHeader("Transfer-Encoding", "chunked");

        try (ZipOutputStream zos = new ZipOutputStream(response.getOutputStream())) {
            zos.setLevel(1); // fast compression, same as archiver level:1 in Node
            addFolderToZip(zos, fullPath, folderName);
        }
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    private void addFolderToZip(ZipOutputStream zos, Path folder, String base) throws IOException {
        try (var entries = Files.newDirectoryStream(folder)) {
            for (Path entry : entries) {
                String entryName = base + "/" + entry.getFileName().toString();
                if (Files.isDirectory(entry)) {
                    zos.putNextEntry(new ZipEntry(entryName + "/"));
                    zos.closeEntry();
                    addFolderToZip(zos, entry, entryName);
                } else {
                    zos.putNextEntry(new ZipEntry(entryName));
                    try (InputStream is = Files.newInputStream(entry)) {
                        is.transferTo(zos);
                    }
                    zos.closeEntry();
                }
            }
        }
    }

    private void pipe(InputStream is, OutputStream os, long bytes) throws IOException {
        byte[] buf = new byte[64 * 1024];
        long remaining = bytes;
        int n;
        while (remaining > 0 && (n = is.read(buf, 0, (int) Math.min(buf.length, remaining))) != -1) {
            os.write(buf, 0, n);
            remaining -= n;
        }
        os.flush();
    }

    private long[] parseRange(String range, long fileSize) {
        try {
            String trimmed = range.replace("bytes=", "");
            String[] parts = trimmed.split("-", 2);
            long start = Long.parseLong(parts[0].trim());
            long end   = parts[1].isBlank() ? fileSize - 1 : Long.parseLong(parts[1].trim());
            if (start >= fileSize || end >= fileSize || start > end) return null;
            return new long[]{start, end};
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
