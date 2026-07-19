package com.trisysit.filetransfer;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.support.SpringBootServletInitializer;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class FileTransferApplication extends SpringBootServletInitializer {

    // Entry point for external Tomcat WAR deployment
    @Override
    protected SpringApplicationBuilder configure(SpringApplicationBuilder builder) {
        return builder.sources(FileTransferApplication.class);
    }

    // Entry point for `mvn spring-boot:run` (embedded Tomcat, dev only)
    public static void main(String[] args) {
        SpringApplication.run(FileTransferApplication.class, args);
    }
}
