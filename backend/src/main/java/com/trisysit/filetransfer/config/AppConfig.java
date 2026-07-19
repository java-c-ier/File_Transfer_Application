package com.trisysit.filetransfer.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.ses.SesClient;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

@Configuration
public class AppConfig {

    @Bean
    public SesClient sesClient(@Value("${aws.ses.region:ap-south-1}") String region) {
        return SesClient.builder()
                .region(Region.of(region))
                .build();
    }

    @Bean
    public Path uploadDir(@Value("${app.upload-dir:./uploads}") String raw) throws IOException {
        Path dir = Path.of(raw).toAbsolutePath().normalize();
        Files.createDirectories(dir);
        return dir;
    }
}
