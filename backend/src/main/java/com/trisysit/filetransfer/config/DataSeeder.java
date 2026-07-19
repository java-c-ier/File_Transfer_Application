package com.trisysit.filetransfer.config;

import com.trisysit.filetransfer.entity.User;
import com.trisysit.filetransfer.repository.UserRepository;
import com.trisysit.filetransfer.service.UserService;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

@Component
public class DataSeeder implements ApplicationRunner {

    private final UserRepository userRepo;
    private final UserService    userService;

    public DataSeeder(UserRepository userRepo, UserService userService) {
        this.userRepo    = userRepo;
        this.userService = userService;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (userRepo.findByUsername("jimut").isEmpty()) {
            User admin = new User("jimut", "jimut_ks@trisysit.com", "ADMIN");
            admin.setFirstName("Jimut");
            admin.setLastName("Kumar Sahoo");
            userRepo.save(admin);
        }
        userService.createWorkspace("jimut");
    }
}
