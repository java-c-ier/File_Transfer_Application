package com.trisysit.filetransfer.controller;

import com.trisysit.filetransfer.dto.CreateUserRequest;
import com.trisysit.filetransfer.dto.UpdateUserRequest;
import com.trisysit.filetransfer.service.UserService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.Map;

@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private static final Logger log = LoggerFactory.getLogger(AdminController.class);

    private final UserService userService;

    public AdminController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping("/users")
    public Map<String, Object> listUsers() {
        log.info("[ADMIN] list_users");
        return Map.of("users", userService.listAll());
    }

    @PostMapping("/users")
    public ResponseEntity<Map<String, Object>> createUser(@RequestBody CreateUserRequest req) {
        log.info("[ADMIN] create_user username={} email={} role={}", req.username(), req.email(), req.role());
        Map<String, Object> result = userService.create(req.username(), req.email(), req.role(), req.firstName(), req.lastName());
        if (result.containsKey("error")) {
            log.warn("[ADMIN] create_user_failed username={} error={}", req.username(), result.get("error"));
            String err = (String) result.get("error");
            int status = err.contains("exists") || err.contains("use") ? 409 : 400;
            return ResponseEntity.status(status).body(result);
        }
        log.info("[ADMIN] create_user_success username={}", req.username());
        return ResponseEntity.ok(result);
    }

    @PutMapping("/users")
    public ResponseEntity<Map<String, Object>> updateUser(@RequestBody UpdateUserRequest req) {
        log.info("[ADMIN] update_user oldUsername={} role={} status={}", req.oldUsername(), req.role(), req.status());
        Map<String, Object> result = userService.update(
                req.oldUsername(), req.newUsername(), req.newEmail(), req.role(), req.firstName(), req.lastName(), req.status());
        if (result.containsKey("error")) {
            log.warn("[ADMIN] update_user_failed oldUsername={} error={}", req.oldUsername(), result.get("error"));
            String err = (String) result.get("error");
            int status = err.contains("not found") ? 404 : err.contains("taken") || err.contains("use") ? 409 : 400;
            return ResponseEntity.status(status).body(result);
        }
        log.info("[ADMIN] update_user_success oldUsername={}", req.oldUsername());
        return ResponseEntity.ok(result);
    }

    @DeleteMapping("/users")
    public ResponseEntity<Map<String, Object>> deleteUser(@RequestParam String username, Principal principal) {
        log.info("[ADMIN] delete_user username={} by={}", username, principal.getName());
        Map<String, Object> result = userService.delete(username, principal.getName());
        if (result.containsKey("error")) {
            log.warn("[ADMIN] delete_user_failed username={} error={}", username, result.get("error"));
            String err = (String) result.get("error");
            int status = err.contains("not found") ? 404 : 403;
            return ResponseEntity.status(status).body(result);
        }
        log.info("[ADMIN] delete_user_success username={}", username);
        return ResponseEntity.ok(result);
    }
}
