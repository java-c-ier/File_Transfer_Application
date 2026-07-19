package com.trisysit.filetransfer.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.AuditorAware;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Optional;

@Configuration
@EnableJpaAuditing(auditorAwareRef = "auditorAware")
public class AuditConfig {

    @Bean
    AuditorAware<String> auditorAware() {
        return () -> {
            try {
                Authentication auth = SecurityContextHolder.getContext().getAuthentication();
                if (auth != null && auth.isAuthenticated() && auth.getPrincipal() instanceof String name) {
                    return Optional.of(name);
                }
                if (auth != null && auth.isAuthenticated()) {
                    return Optional.of(auth.getName());
                }
            } catch (Exception ignored) {}
            return Optional.of("SYSTEM");
        };
    }
}
