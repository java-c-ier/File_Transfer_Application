package com.trisysit.filetransfer.util;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class PathUtils {

    private PathUtils() {}

    /**
     * Resolve a user-supplied relative path safely within a base directory.
     * Returns null if the resolved path would escape the base (path traversal).
     */
    public static Path safePath(Path base, String relative) {
        if (relative == null) relative = "";
        Path root     = base.toAbsolutePath().normalize();
        // strip leading slashes to prevent absolute-path injection
        String stripped = relative.replaceAll("^[/\\\\]+", "");
        Path resolved = root.resolve(stripped).normalize();
        if (!resolved.startsWith(root)) return null;
        return resolved;
    }

    /** Sanitize a filename: strip directory components and ".." sequences. */
    public static String sanitizeFilename(String raw) {
        if (raw == null) return "";
        return Path.of(raw.replace("..", "")).getFileName().toString();
    }

    /** The folder name a username maps to under the upload root. */
    public static String dirName(String username) {
        return username.replaceAll("[^a-zA-Z0-9@._\\-]", "_");
    }

    /**
     * Returns uploadRoot/{username} as an absolute path, creating the directory if absent.
     * Username is stripped to filesystem-safe characters before use.
     */
    public static Path userDir(Path uploadRoot, String username) throws IOException {
        Path root = uploadRoot.toAbsolutePath().normalize();
        Path dir = root.resolve(dirName(username)).normalize();
        if (!dir.startsWith(root)) throw new IllegalArgumentException("Invalid username");
        Files.createDirectories(dir);
        return dir;
    }
}
