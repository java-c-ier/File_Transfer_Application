package com.trisysit.filetransfer.service;

import com.trisysit.filetransfer.entity.RetentionHold;
import com.trisysit.filetransfer.repository.RetentionHoldRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

@Service
public class RetentionHoldService {

    private final RetentionHoldRepository repo;

    public RetentionHoldService(RetentionHoldRepository repo) {
        this.repo = repo;
    }

    @Transactional(readOnly = true)
    public Set<String> heldPaths(String ownerDir) {
        Set<String> paths = new HashSet<>();
        for (RetentionHold h : repo.findByOwnerDir(ownerDir)) paths.add(h.getPath());
        return paths;
    }

    /** True when {@code relPath} is held itself or sits inside a held folder. */
    public static boolean covers(Set<String> held, String relPath) {
        if (held.isEmpty()) return false;
        String p = relPath;
        while (true) {
            if (held.contains(p)) return true;
            int slash = p.lastIndexOf('/');
            if (slash < 0) return false;
            p = p.substring(0, slash);
        }
    }

    @Transactional
    public void setKept(String ownerDir, String path, boolean keep) {
        Optional<RetentionHold> existing = repo.findByOwnerDirAndPath(ownerDir, path);
        if (keep && existing.isEmpty()) {
            RetentionHold h = new RetentionHold();
            h.setOwnerDir(ownerDir);
            h.setPath(path);
            repo.save(h);
        } else if (!keep && existing.isPresent()) {
            repo.delete(existing.get());
        }
    }

    /** A held item (or folder tree) was renamed — its hold follows it. */
    @Transactional
    public void moved(String ownerDir, String oldPath, String newPath) {
        if (oldPath.equals(newPath)) return;
        String oldPrefix = oldPath + "/";
        for (RetentionHold h : repo.findByOwnerDir(ownerDir)) {
            if (h.getPath().equals(oldPath)) {
                h.setPath(newPath);
                repo.save(h);
            } else if (h.getPath().startsWith(oldPrefix)) {
                h.setPath(newPath + h.getPath().substring(oldPath.length()));
                repo.save(h);
            }
        }
    }

    /** A file or folder was deleted — drop its hold and any holds inside it. */
    @Transactional
    public void removed(String ownerDir, String path) {
        String prefix = path + "/";
        List<RetentionHold> gone = repo.findByOwnerDir(ownerDir).stream()
                .filter(h -> h.getPath().equals(path) || h.getPath().startsWith(prefix))
                .toList();
        repo.deleteAll(gone);
    }

    @Transactional
    public void transferOwner(String oldDir, String newDir) {
        if (oldDir.equals(newDir)) return;
        for (RetentionHold h : repo.findByOwnerDir(oldDir)) {
            h.setOwnerDir(newDir);
            repo.save(h);
        }
    }

    @Transactional
    public void removeAll(String ownerDir) {
        repo.deleteAll(repo.findByOwnerDir(ownerDir));
    }
}
