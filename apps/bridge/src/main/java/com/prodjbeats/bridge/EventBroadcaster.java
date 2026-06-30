package com.prodjbeats.bridge;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

final class EventBroadcaster implements AutoCloseable {
    private final Set<EventSink> sinks = ConcurrentHashMap.newKeySet();
    private final BufferedWriter eventLog;

    EventBroadcaster(Path eventLogPath) throws IOException {
        Files.createDirectories(eventLogPath.toAbsolutePath().getParent());
        eventLog = Files.newBufferedWriter(
                eventLogPath,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND
        );
    }

    void add(EventSink sink) {
        sinks.add(sink);
    }

    void remove(EventSink sink) {
        sinks.remove(sink);
    }

    void publish(CanonicalEvent event) {
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
