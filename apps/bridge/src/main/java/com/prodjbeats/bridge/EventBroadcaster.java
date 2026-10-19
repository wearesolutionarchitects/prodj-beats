package com.prodjbeats.bridge;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Set;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

final class EventBroadcaster implements AutoCloseable {
    private final Set<EventSink> sinks = ConcurrentHashMap.newKeySet();
    private final BufferedWriter eventLog;
    private CanonicalEvent onAir;
    private CanonicalEvent master;
    private CanonicalEvent diagnostics;
    private final Map<Integer, Map<String, CanonicalEvent>> latest = new LinkedHashMap<>();

    EventBroadcaster(Path eventLogPath) throws IOException {
        Files.createDirectories(eventLogPath.toAbsolutePath().getParent());
        eventLog = Files.newBufferedWriter(
                eventLogPath,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND
        );
    }

    synchronized void add(EventSink sink) {
        try {
            long now = System.currentTimeMillis();
            for (Map<String, CanonicalEvent> deck : latest.values()) {
                for (String type : List.of("device", "track", "structure", "art", "beat", "position", "mixer")) {
                    CanonicalEvent event = deck.get(type);
                    if (event != null) sink.send(new CanonicalEvent(type, 2, now, event.payload()).toJson());
                }
            }
            if (diagnostics != null) sink.send(new CanonicalEvent("diagnostics", 2, now, diagnostics.payload()).toJson());
            if (master != null) sink.send(new CanonicalEvent("master", 2, now, master.payload()).toJson());
            if (onAir != null) sink.send(new CanonicalEvent("onAir", 2, now, onAir.payload()).toJson());
            sinks.add(sink);
        } catch (IOException ex) {
            sink.close();
        }
    }

    void remove(EventSink sink) {
        sinks.remove(sink);
    }

    synchronized void publish(CanonicalEvent event) {
        if (event.type().equals("diagnostics")) diagnostics = event;
        if (event.type().equals("master")) master = event;
        if (event.type().equals("device") && Boolean.FALSE.equals(event.payload().get("active")) &&
                master != null && java.util.Objects.equals(master.payload().get("player"), event.payload().get("player"))) master = null;
        if (event.type().equals("onAir")) onAir = event;
        if (event.type().equals("device") && Boolean.FALSE.equals(event.payload().get("active"))) onAir = null;
        Object player = event.payload().get("player");
        if (!event.type().equals("master") && !event.type().equals("diagnostics") && player instanceof Integer number) {
            Map<String, CanonicalEvent> deck = latest.computeIfAbsent(number, ignored -> new LinkedHashMap<>());
            CanonicalEvent track = deck.get("track");
            if ((event.type().equals("device") && Boolean.FALSE.equals(event.payload().get("active"))) ||
                    (event.type().equals("track") && (event.payload().get("source") == null || track == null ||
                    !java.util.Objects.equals(track.payload().get("source"), event.payload().get("source"))))) {
                deck.keySet().removeAll(List.of("track", "structure", "art", "beat", "position", "mixer"));
            }
            deck.put(event.type(), event);
        }
        String message = event.toJson();
        writeEventLog(message);
        for (EventSink sink : sinks) {
            try {
                sink.send(message);
            } catch (IOException ex) {
                sink.close();
            }
        }
        System.out.println(message);
    }

    // Keep bounded waveform diagnostics inspectable after terminal scrollback expires.
    // They are log-only: no UI event, device control or lighting output.
    void logWaveformDiagnostic(String message) {
        writeEventLog(new CanonicalEvent("waveform", 2, System.currentTimeMillis(), Map.of("message", message)).toJson());
        System.out.println(message);
    }

    private void writeEventLog(String message) {
        synchronized (eventLog) {
            try {
                eventLog.write(message);
                eventLog.newLine();
                eventLog.flush();
            } catch (IOException ex) {
                System.err.println("Unable to write bridge event log: " + ex.getMessage());
            }
        }
    }

    @Override
    public void close() {
        synchronized (eventLog) {
            try {
                eventLog.close();
            } catch (IOException ignored) {
            }
        }
    }
}
