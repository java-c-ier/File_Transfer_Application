package com.trisysit.filetransfer.repository;

import com.trisysit.filetransfer.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, String> {
    Optional<User> findByUsername(String username);
    boolean existsByUsername(String username);
    Optional<User> findByEmail(String email);
    boolean existsByEmail(String email);
    List<User> findByRole(String role);

    @Query("SELECT u FROM User u WHERE u.username = :id OR LOWER(u.email) = LOWER(:id)")
    Optional<User> findByUsernameOrEmail(@Param("id") String identifier);
}
