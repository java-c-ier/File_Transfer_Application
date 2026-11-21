package com.trisysit.filetransfer.security;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** The session cookie, written the same way whether it is set at login or renewed by activity. */
@Component
public class AuthCookies {

    private static final String NAME = "auth_token";

    private final JwtService jwtService;

    @Value("${app.cookie-secure:false}")
    private boolean secure;

    public AuthCookies(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    public void set(HttpServletResponse response, String token) {
        Cookie cookie = new Cookie(NAME, token);
        cookie.setHttpOnly(true);
        cookie.setPath("/");
        cookie.setMaxAge((int) jwtService.sessionLifetimeSeconds());
        cookie.setAttribute("SameSite", "Strict");
        if (secure) cookie.setSecure(true);
        response.addCookie(cookie);
    }

    public void clear(HttpServletResponse response) {
        Cookie cookie = new Cookie(NAME, "");
        cookie.setHttpOnly(true);
        cookie.setPath("/");
        cookie.setMaxAge(0);
        cookie.setAttribute("SameSite", "Strict");
        response.addCookie(cookie);
    }
}
