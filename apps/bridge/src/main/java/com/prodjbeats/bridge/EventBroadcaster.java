package com.prodjbeats.bridge;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

final class EventBroadcaster {
    private final Set<EventSink> sinks = ConcurrentHashMap.newKeySet();

    void add(EventSink sink) {
        sinks.add(sink);
    }

    void remove(EventSink sink) {
        sinks.remove(sink);
    }

    void publish(CanonicalEvent event) {
        String message = event.toJson();
        for (EventSink sink : sinks) {
            try {
                sink.send(message);
            } catch (IOException ex) {
                sink.close();
            }
        }
        System.out.println(message);
    }
}
