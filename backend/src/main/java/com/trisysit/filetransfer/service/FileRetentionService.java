package com.trisysit.filetransfer.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;

/**
 * Deletes uploaded files whose last modification is older than the retention period,
 * plus folders left empty by that cleanup (or already empty and equally old).
 */
@Service
public class FileRetentionService {

    private static final Logger log = LoggerFactory.getLogger(FileRetentionService.class);

    private final Path uploadDir;
    private final SseService sseService;
    private final StatsService statsService;
    private final RetentionHoldService holds;
    private final int retentionDays;

    public FileRetentionService(Path uploadDir, SseService sseService, StatsService statsService,
                                RetentionHoldService holds,
                                @Value("${app.file-retention-days:14}") int retentionDays) {
        this.uploadDir     = uploadDir;
        this.sseService    = sseService;
        this.statsService  = statsService;
        this.holds         = holds;
        this.retentionDays = retentionDays;
    }

    public boolean isEnabled() {
        return retentionDays > 0;
    }

    public int retentionDays() {
        return retentionDays;
    }

    /** When a file last modified at {@code modified} will be deleted, or null if retention is off. */
    public Instant expiresAt(Instant modified) {
        return isEnabled() ? modified.plus(Duration.ofDays(retentionDays)) : null;
    }

    // Daily at 03:30 server time (after the 03:00 chunk cleanup).
    @Scheduled(cron = "${app.file-retention-cron:0 30 3 * * *}")
    public void purgeExpiredScheduled() {
        long start = System.currentTimeMillis();
        try {
            int n = purgeExpired(Instant.now());
            log.info("[RETENTION] run_complete deleted={} tookMs={}", n, System.currentTimeMillis() - start);
        } catch (RuntimeException e) {
            log.error("[RETENTION] run_failed", e);
        }
    }

    public int purgeExpired(Instant now) {
        if (!isEnabled()) return 0;
        Instant cutoff = now.minus(Duration.ofDays(retentionDays));
        int total = 0;
        try (DirectoryStream<Path> users = Files.newDirectoryStream(uploadDir, Files::isDirectory)) {
            for (Path userRoot : users) {
                String username = userRoot.getFileName().toString();
                if (username.startsWith(".")) continue; // e.g. .chunks
                try {
                    int n = purgeUser(userRoot, cutoff);
                    if (n > 0) {
                        statsService.invalidate(username);
                        sseService.broadcast(username, "delete");
                        log.info("[RETENTION] deleted={} user={} olderThanDays={}", n, username, retentionDays);
                        total += n;
                    }
                } catch (RuntimeException e) {
                    log.error("[RETENTION] user_failed user={}", username, e); // keep going with other users
                }
            }
        } catch (IOException e) {
            log.error("[RETENTION] failed to scan upload dir", e);
        }
        return total;
    }

    private int purgeUser(Path userRoot, Instant cutoff) {
        int[] deleted = {0};
        Set<Path> emptiedByUs = new HashSet<>();
        // Admin-kept files and folders; a kept folder protects everything inside it.
        Set<String> held = holds.heldPaths(userRoot.getFileName().toString());
        try {
            Files.walkFileTree(userRoot, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                    if (dir.equals(userRoot)) return FileVisitResult.CONTINUE;
                    boolean skip = dir.getFileName().toString().startsWith(".")
                            || RetentionHoldService.covers(held, relative(userRoot, dir));
                    return skip ? FileVisitResult.SKIP_SUBTREE : FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    if (attrs.isRegularFile() && expires(file, userRoot)
                            && !RetentionHoldService.covers(held, relative(userRoot, file))
                            && attrs.lastModifiedTime().toInstant().isBefore(cutoff)) {
                        try {
                            Files.delete(file);
                            deleted[0]++;
                            emptiedByUs.add(file.getParent());
                        } catch (IOException e) {
                            log.warn("[RETENTION] could not delete {}: {}", file, e.getMessage());
                        }
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFileFailed(Path file, IOException exc) {
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult postVisitDirectory(Path dir, IOException exc) {
                    if (dir.equals(userRoot)) return FileVisitResult.CONTINUE;
                    try {
                        boolean stale = Files.getLastModifiedTime(dir).toInstant().isBefore(cutoff);
                        if ((emptiedByUs.contains(dir) || stale) && isEmpty(dir)) {
                            Files.delete(dir);
                            deleted[0]++;
                            emptiedByUs.add(dir.getParent());
                        }
                    } catch (IOException e) {
                        log.warn("[RETENTION] could not delete folder {}: {}", dir, e.getMessage());
                    }
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException e) {
            log.error("[RETENTION] failed to scan {}", userRoot, e);
        }
        return deleted[0];
    }

    private static String relative(Path userRoot, Path path) {
        return userRoot.relativize(path).toString().replace(java.io.File.separatorChar, '/');
    }

    // The per-user text-editor note and hidden files are not uploads.
    private static boolean expires(Path file, Path userRoot) {
        String name = file.getFileName().toString();
        if (name.startsWith(".")) return false;
        return !(name.equals("text.txt") && file.getParent().equals(userRoot));
    }

    private static boolean isEmpty(Path dir) throws IOException {
        try (DirectoryStream<Path> s = Files.newDirectoryStream(dir)) {
            return !s.iterator().hasNext();
        }
    }
}
