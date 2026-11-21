package com.trisysit.filetransfer.service;

import com.trisysit.filetransfer.entity.User;
import com.trisysit.filetransfer.repository.UserRepository;
import com.trisysit.filetransfer.util.PathUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class UserService {

    private final UserRepository userRepo;
    private final Path uploadDir;

    public UserService(UserRepository userRepo, Path uploadDir) {
        this.userRepo  = userRepo;
        this.uploadDir = uploadDir;
    }

    public List<Map<String, String>> listAll() {
        return userRepo.findAll().stream()
                .map(u -> {
                    Map<String, String> m = new java.util.LinkedHashMap<>();
                    m.put("username",  u.getUsername());
                    m.put("email",     u.getEmail()     != null ? u.getEmail()     : "");
                    m.put("role",      u.getRole());
                    m.put("firstName", u.getFirstName() != null ? u.getFirstName() : "");
                    m.put("lastName",  u.getLastName()  != null ? u.getLastName()  : "");
                    m.put("status",    u.getStatus()    != null ? u.getStatus()    : "ACTIVE");
                    return m;
                })
                .toList();
    }

    @Transactional
    public Map<String, Object> create(String username, String email, String role, String firstName, String lastName) {
        if (username == null || username.isBlank()) return Map.of("error", "Username is required");
        if (email    == null || email.isBlank())    return Map.of("error", "Email is required");

        String cleanName  = username.trim();
        String cleanEmail = email.trim().toLowerCase();

        if (userRepo.existsByUsername(cleanName))   return Map.of("error", "User already exists");
        if (userRepo.existsByEmail(cleanEmail))     return Map.of("error", "Email already in use");

        User user = new User(cleanName, cleanEmail, "ADMIN".equals(role) ? "ADMIN" : "USER");
        if (firstName != null && !firstName.isBlank()) user.setFirstName(firstName.trim());
        if (lastName  != null && !lastName.isBlank())  user.setLastName(lastName.trim());
        userRepo.save(user);
        createWorkspace(cleanName);
        return Map.of("success", true, "username", cleanName);
    }

    @Transactional
    public Map<String, Object> update(String oldUsername, String newUsername, String newEmail, String role, String firstName, String lastName, String status) {
        Optional<User> opt = userRepo.findByUsername(oldUsername);
        if (opt.isEmpty()) return Map.of("error", "User not found");

        User user = opt.get();
        String targetName = (newUsername != null) ? newUsername.trim() : oldUsername;

        if (!targetName.equals(oldUsername) && userRepo.existsByUsername(targetName))
            return Map.of("error", "Username already taken");

        if (!targetName.equals(oldUsername)) renameWorkspace(oldUsername, targetName);
        user.setUsername(targetName);

        if (newEmail != null && !newEmail.isBlank()) {
            String cleanEmail = newEmail.trim().toLowerCase();
            if (!cleanEmail.equals(user.getEmail()) && userRepo.existsByEmail(cleanEmail))
                return Map.of("error", "Email already in use");
            user.setEmail(cleanEmail);
        }

        if (role != null) user.setRole("ADMIN".equals(role) ? "ADMIN" : "USER");
        if (firstName != null && !firstName.isBlank()) user.setFirstName(firstName.trim());
        if (lastName  != null && !lastName.isBlank())  user.setLastName(lastName.trim());
        if (status    != null && !status.isBlank())    user.setStatus(status.trim().toUpperCase());

        userRepo.save(user);
        return Map.of("success", true);
    }

    @Transactional
    public Map<String, Object> delete(String username, String requestingUser) {
        if (username.equals(requestingUser)) return Map.of("error", "Cannot delete yourself");

        Optional<User> opt = userRepo.findByUsername(username);
        if (opt.isEmpty()) return Map.of("error", "User not found");

        User user = opt.get();
        if ("ADMIN".equals(user.getRole()) && userRepo.findByRole("ADMIN").size() <= 1)
            return Map.of("error", "Cannot delete the final root admin");

        userRepo.delete(user);
        deleteWorkspace(username);
        return Map.of("success", true);
    }

    private void deleteWorkspace(String username) {
        try {
            String safe = username.replaceAll("[^a-zA-Z0-9@._\\-]", "_");
            Path dir = uploadDir.toAbsolutePath().normalize().resolve(safe).normalize();
            if (!dir.startsWith(uploadDir.toAbsolutePath().normalize())) return;
            if (!Files.exists(dir)) return;
            Files.walk(dir)
                 .sorted(Comparator.reverseOrder())
                 .forEach(p -> { try { Files.deleteIfExists(p); } catch (IOException ignored) {} });
        } catch (IOException e) {
            throw new RuntimeException("Failed to delete user workspace", e);
        }
    }

    public void createWorkspace(String username) {
        try {
            Path dir = PathUtils.userDir(uploadDir, username);
            Path txt = dir.resolve("text.txt");
            if (!txt.toFile().exists()) {
                Files.writeString(txt, "", StandardCharsets.UTF_8);
            }
        } catch (IOException e) {
            throw new RuntimeException("Failed to create user workspace", e);
        }
    }

    public void renameWorkspace(String oldUsername, String newUsername) {
        try {
            String safeOld = oldUsername.replaceAll("[^a-zA-Z0-9@._\\-]", "_");
            String safeNew = newUsername.replaceAll("[^a-zA-Z0-9@._\\-]", "_");
            Path oldDir = uploadDir.resolve(safeOld).normalize();
            Path newDir = uploadDir.resolve(safeNew).normalize();
            if (Files.exists(oldDir)) {
                Files.move(oldDir, newDir, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new RuntimeException("Failed to rename user workspace", e);
        }
    }
}
