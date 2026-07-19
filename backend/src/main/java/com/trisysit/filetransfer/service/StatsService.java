package com.trisysit.filetransfer.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class StatsService {

    private final Path uploadDir;
    private final long maxFileSizeBytes;
    private static final long CACHE_TTL_MS = 30_000;

    private record CacheEntry(Map<String, Object> data, long at) {}
    private final ConcurrentHashMap<String, CacheEntry> cache = new ConcurrentHashMap<>();

    public StatsService(Path uploadDir,
                        @Value("${app.max-file-size-mb:500}") long maxFileSizeMb) {
        this.uploadDir        = uploadDir;
        this.maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;
    }

    public Map<String, Object> getStats(String username) throws IOException {
        long now = System.currentTimeMillis();
        CacheEntry entry = cache.get(username);
        if (entry != null && now - entry.at() < CACHE_TTL_MS) return entry.data();

        String safe    = username.replaceAll("[^a-zA-Z0-9@._\\-]", "_");
        Path userDir   = uploadDir.resolve(safe);
        long[] result  = new long[2]; // [totalSize, fileCount]
        if (Files.exists(userDir)) walkDir(userDir, result);

        Map<String, Object> data = Map.of("totalSize", result[0], "fileCount", result[1], "maxUploadSize", maxFileSizeBytes);
        cache.put(username, new CacheEntry(data, now));
        return data;
    }

    public void invalidate(String username) {
        cache.remove(username);
    }

    public void invalidateAll() {
        cache.clear();
    }

    private void walkDir(Path dir, long[] result) throws IOException {
        try (var entries = Files.newDirectoryStream(dir)) {
            for (Path entry : entries) {
                String name = entry.getFileName().toString();
                if (name.startsWith(".") || name.endsWith(".uploading") || name.equals("text.txt")) continue;

                if (Files.isDirectory(entry)) {
                    walkDir(entry, result);
                } else {
                    result[0] += Files.size(entry);
                    result[1]++;
                }
            }
        }
    }
}
