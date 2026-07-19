package com.trisysit.filetransfer.service;

import com.trisysit.filetransfer.util.PathUtils;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;

@Service
public class FileService {

    private final Path uploadDir;
    private final SseService sseService;
    private final StatsService statsService;

    public FileService(Path uploadDir, SseService sseService, StatsService statsService) {
        this.uploadDir  = uploadDir;
        this.sseService = sseService;
        this.statsService = statsService;
    }

    public Map<String, Object> listFiles(String username, String subPath, int limit, int offset) throws IOException {
        Path userRoot  = PathUtils.userDir(uploadDir, username);
        Path targetDir = PathUtils.safePath(userRoot, subPath != null ? subPath : "");
        if (targetDir == null) throw new IllegalArgumentException("Invalid path");

        String sanitized = userRoot.relativize(targetDir).toString().replace(File.separatorChar, '/');

        if (!Files.exists(targetDir)) {
            return Map.of("files", List.of(), "currentPath", sanitized, "total", 0, "exists", false);
        }

        List<Map<String, Object>> files = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(targetDir)) {
            for (Path entry : stream) {
                String name = entry.getFileName().toString();
                if (name.startsWith(".") || name.endsWith(".uploading") || name.equals("text.txt")) continue;

                BasicFileAttributes attrs = Files.readAttributes(entry, BasicFileAttributes.class);
                boolean isDir = attrs.isDirectory();
                String entryPath = sanitized.isEmpty() ? name : sanitized + "/" + name;

                Map<String, Object> item = new LinkedHashMap<>();
                item.put("name", name);
                item.put("isDirectory", isDir);
                item.put("size", isDir ? null : attrs.size());
                item.put("modified", attrs.lastModifiedTime().toInstant());
                item.put("path", entryPath);
                files.add(item);
            }
        }

        files.sort((a, b) -> {
            boolean aDir = (boolean) a.get("isDirectory");
            boolean bDir = (boolean) b.get("isDirectory");
            if (aDir && !bDir) return -1;
            if (!aDir && bDir) return 1;
            return ((String) a.get("name")).compareToIgnoreCase((String) b.get("name"));
        });

        int total   = files.size();
        int from    = Math.min(offset, total);
        int to      = Math.min(offset + limit, total);
        List<Map<String, Object>> page = files.subList(from, to);

        return Map.of("files", page, "currentPath", sanitized, "total", total);
    }

    public Map<String, Object> createFolder(String username, String name, String parentPath) throws IOException {
        if (name == null || name.isBlank()) throw new IllegalArgumentException("Folder name required");

        Path userRoot  = PathUtils.userDir(uploadDir, username);
        String safeName = name.replace("..", "").replaceAll("[/\\\\]", "");
        Path parentFull = PathUtils.safePath(userRoot, parentPath != null ? parentPath : "");
        if (parentFull == null) throw new IllegalArgumentException("Invalid path");

        Path fullPath = parentFull.resolve(safeName);
        if (!fullPath.startsWith(userRoot)) throw new IllegalArgumentException("Invalid path");

        if (Files.exists(fullPath)) {
            return Map.of("error", "Folder already exists");
        }

        Files.createDirectories(fullPath);
        statsService.invalidate(username);
        sseService.broadcast("folder");
        return Map.of("success", true, "path", userRoot.relativize(fullPath).toString().replace(File.separatorChar, '/'));
    }

    public Map<String, Object> delete(String username, String filePath) throws IOException {
        Path userRoot = PathUtils.userDir(uploadDir, username);
        Path fullPath = PathUtils.safePath(userRoot, filePath);
        if (fullPath == null) throw new IllegalArgumentException("Invalid path");
        if (fullPath.equals(userRoot)) return Map.of("error", "Cannot delete root");
        if (!Files.exists(fullPath)) return Map.of("error", "File not found");

        if (Files.isDirectory(fullPath)) {
            deleteRecursive(fullPath);
        } else {
            Files.delete(fullPath);
        }

        statsService.invalidate(username);
        sseService.broadcast("delete");
        return Map.of("success", true);
    }

    public Map<String, Object> rename(String username, String oldPath, String newName) throws IOException {
        if (oldPath == null || newName == null) throw new IllegalArgumentException("Missing parameters");

        Path userRoot    = PathUtils.userDir(uploadDir, username);
        Path fullOldPath = PathUtils.safePath(userRoot, oldPath);
        if (fullOldPath == null) throw new IllegalArgumentException("Invalid path");

        String safeName  = newName.replace("..", "").replaceAll("[/\\\\]", "");
        Path fullNewPath = fullOldPath.getParent().resolve(safeName);
        if (!fullNewPath.startsWith(userRoot)) throw new IllegalArgumentException("Invalid path");

        if (!Files.exists(fullOldPath)) return Map.of("error", "File not found");

        Files.move(fullOldPath, fullNewPath, StandardCopyOption.REPLACE_EXISTING);
        statsService.invalidate(username);
        sseService.broadcast("rename");
        return Map.of("success", true);
    }

    public String readText(String username) {
        try {
            Path file = PathUtils.userDir(uploadDir, username).resolve("text.txt");
            if (!Files.exists(file)) return "";
            return Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }

    public void writeText(String username, String text) {
        try {
            Path file = PathUtils.userDir(uploadDir, username).resolve("text.txt");
            Files.writeString(file, text != null ? text : "", StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new RuntimeException("Failed to save text", e);
        }
        sseService.broadcast("text");
    }

    private void deleteRecursive(Path path) throws IOException {
        Files.walkFileTree(path, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                Files.delete(file);
                return FileVisitResult.CONTINUE;
            }
            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
                Files.delete(dir);
                return FileVisitResult.CONTINUE;
            }
        });
    }
}
