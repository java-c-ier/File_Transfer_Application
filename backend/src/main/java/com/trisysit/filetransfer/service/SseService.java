package com.trisysit.filetransfer.service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

@Service
public class SseService {

    // Keyed by username so each user only receives their own file-change events
    private final ConcurrentHashMap<String, CopyOnWriteArrayList<SseEmitter>> emittersByUser =
            new ConcurrentHashMap<>();

    public SseEmitter subscribe(String username) {
        SseEmitter emitter = new SseEmitter(60_000L); // 60 s timeout; client auto-reconnects
        CopyOnWriteArrayList<SseEmitter> list =
                emittersByUser.computeIfAbsent(username, k -> new CopyOnWriteArrayList<>());
        list.add(emitter);
        emitter.onCompletion(() -> removeEmitter(username, emitter));
        emitter.onTimeout(()   -> removeEmitter(username, emitter));
        emitter.onError(e      -> removeEmitter(username, emitter));

        try {
            emitter.send(SseEmitter.event().comment("connected").reconnectTime(5000));
        } catch (IOException e) {
            removeEmitter(username, emitter);
        }
        return emitter;
    }

    public void broadcast(String username, String reason) {
        CopyOnWriteArrayList<SseEmitter> list = emittersByUser.get(username);
        if (list == null || list.isEmpty()) return;
        List<SseEmitter> dead = new ArrayList<>();
        for (SseEmitter emitter : list) {
            try {
                emitter.send(SseEmitter.event()
                        .name("change")
                        .data(Map.of("reason", reason)));
            } catch (Exception e) {
                dead.add(emitter);
            }
        }
        list.removeAll(dead);
    }

    /** Keep-alive ping every 30 s — also prunes dead connections */
    @Scheduled(fixedRate = 30_000)
    public void heartbeat() {
        emittersByUser.forEach((user, list) -> {
            List<SseEmitter> dead = new ArrayList<>();
            for (SseEmitter em : list) {
                try { em.send(SseEmitter.event().comment("ping")); }
                catch (Exception e) { dead.add(em); }
            }
            list.removeAll(dead);
            if (list.isEmpty()) emittersByUser.remove(user, list);
        });
    }

    private void removeEmitter(String username, SseEmitter emitter) {
        CopyOnWriteArrayList<SseEmitter> list = emittersByUser.get(username);
        if (list != null) {
            list.remove(emitter);
            if (list.isEmpty()) emittersByUser.remove(username, list);
        }
    }
}
