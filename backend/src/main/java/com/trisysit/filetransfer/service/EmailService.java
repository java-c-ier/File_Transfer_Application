package com.trisysit.filetransfer.service;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.ses.SesClient;
import software.amazon.awssdk.services.ses.model.*;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Year;

@Service
public class EmailService {

    private final SesClient sesClient;

    @Value("${aws.ses.from-email}")
    private String fromEmail;

    private String otpTemplate;

    public EmailService(SesClient sesClient) {
        this.sesClient = sesClient;
    }

    @PostConstruct
    public void init() {
        try (InputStream is = getClass().getResourceAsStream("/templates/login-otp.html")) {
            if (is == null) throw new IOException("login-otp.html not found on classpath");
            otpTemplate = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new RuntimeException("Failed to load OTP email template", e);
        }
    }

    public void sendOtp(String toEmail, String firstName, String lastName, String otp) {
        String displayName = buildDisplayName(firstName, lastName);
        try {
            sesClient.sendEmail(SendEmailRequest.builder()
                    .source(fromEmail)
                    .destination(Destination.builder().toAddresses(toEmail).build())
                    .message(Message.builder()
                            .subject(Content.builder()
                                    .data("Your Login OTP – File Transfer")
                                    .charset("UTF-8")
                                    .build())
                            .body(Body.builder()
                                    .html(Content.builder()
                                            .data(buildBody(displayName, otp))
                                            .charset("UTF-8")
                                            .build())
                                    .build())
                            .build())
                    .build());
        } catch (SesException e) {
            System.err.println("[EmailService] SES send failed to " + toEmail + ": " + e.awsErrorDetails().errorMessage());
        }
    }

    private String buildDisplayName(String firstName, String lastName) {
        if (firstName != null && !firstName.isBlank()) return firstName.trim();
        if (lastName  != null && !lastName.isBlank())  return lastName.trim();
        return "there";
    }

    private String buildBody(String displayName, String otp) {
        return otpTemplate
                .replace("{{displayName}}", displayName)
                .replace("{{otp}}", otp)
                .replace("{{year}}", String.valueOf(Year.now().getValue()));
    }
}
