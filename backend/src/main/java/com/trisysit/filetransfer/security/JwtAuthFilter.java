package com.trisysit.filetransfer.security;

import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtService jwtService;
    private final AuthCookies authCookies;

    public JwtAuthFilter(JwtService jwtService, AuthCookies authCookies) {
        this.jwtService  = jwtService;
        this.authCookies = authCookies;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String token = extractToken(request);

        if (token != null) {
            try {
                if (jwtService.isValid(token)) {
                    String username = jwtService.extractUsername(token);
                    String role     = jwtService.extractRole(token);

                    var auth = new UsernamePasswordAuthenticationToken(
                            username, null,
                            List.of(new SimpleGrantedAuthority("ROLE_" + role))
                    );
                    auth.setDetails(role);
                    SecurityContextHolder.getContext().setAuthentication(auth);

                    // Sliding session: real use pushes the expiry out by a full window again.
                    if (countsAsActivity(request)) {
                        jwtService.renew(token).ifPresent(fresh -> authCookies.set(response, fresh));
                    }
                }
            } catch (JwtException | IllegalArgumentException ignored) {}
        }

        chain.doFilter(request, response);
    }

    // The live-update stream reconnects by itself every minute, so counting it would keep an idle
    // tab signed in forever. Logout sets its own cookie and must not be overridden by a renewal.
    private static boolean countsAsActivity(HttpServletRequest request) {
        String uri = request.getRequestURI();
        return !uri.endsWith("/api/events") && !uri.endsWith("/api/auth/logout");
    }

    // Primary: httpOnly cookie. Fallback: Authorization header (curl / dev tooling).
    private String extractToken(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie c : cookies) {
                if ("auth_token".equals(c.getName())) return c.getValue();
            }
        }
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            return header.substring(7);
        }
        return null;
    }
}
