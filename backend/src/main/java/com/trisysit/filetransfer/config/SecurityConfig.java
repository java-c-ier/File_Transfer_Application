package com.trisysit.filetransfer.config;

import com.trisysit.filetransfer.security.JwtAuthFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import org.springframework.http.HttpMethod;

import java.util.List;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final JwtAuthFilter jwtAuthFilter;

    public SecurityConfig(JwtAuthFilter jwtAuthFilter) {
        this.jwtAuthFilter = jwtAuthFilter;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .cors(cors -> cors.configurationSource(corsSource()))
            .csrf(csrf -> csrf.disable())
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .headers(headers -> {
                headers.contentTypeOptions(c -> {});
                headers.frameOptions(f -> f.deny());
                headers.referrerPolicy(r -> r.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.SAME_ORIGIN));
                headers.permissionsPolicy(p -> p.policy("camera=(), microphone=()"));
                headers.contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'self'"));
            })
            .authorizeHttpRequests(auth -> auth
                // Public: OTP request + verify, health check, session check
                .requestMatchers("/api/auth/login/request-otp", "/api/auth/login/verify-otp", "/api/health", "/api/auth/me").permitAll()
                // Public GET: share info + one-time download (POST /api/share requires auth)
                .requestMatchers(HttpMethod.GET, "/api/share/*", "/api/share/*/download").permitAll()
                // Admin only
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                // All other endpoints (including SSE) require authentication via cookie
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    // Open CORS: allow any origin (pattern-based so credentials still work),
    // all common methods, all request headers, expose download/range headers to JS.
    @Bean
    public CorsConfigurationSource corsSource() {
        CorsConfiguration cfg = new CorsConfiguration();
        // setAllowedOriginPatterns is required when allowCredentials=true — wildcard "*" is not permitted
        cfg.setAllowedOriginPatterns(List.of(
            "https://apps.trisysit.com",
            "http://localhost:5173",
            "http://localhost:5174"
        ));
        cfg.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"));
        cfg.setAllowedHeaders(List.of("*"));
        cfg.setAllowCredentials(true);
        // Expose headers JS needs for download resume and progress reporting
        cfg.setExposedHeaders(List.of(
            "Content-Disposition", "Content-Length", "Content-Range",
            "Accept-Ranges", "Transfer-Encoding"
        ));
        cfg.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cfg);
        return source;
    }
}
