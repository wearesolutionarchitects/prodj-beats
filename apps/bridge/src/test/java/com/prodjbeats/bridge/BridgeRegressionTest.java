package com.prodjbeats.bridge;

import java.lang.reflect.Method;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Standalone tests: no hardware, runtime JARs or test framework required. */
public final class BridgeRegressionTest {
    public static void main(String[] args) throws Exception {
        var log = Files.createTempFile("prodj-bridge-test", ".jsonl");
        try (var broadcaster = new EventBroadcaster(log)) {
            var sink = new RecordingSink();
            broadcaster.add(sink);
            var adapter = new BeatLinkAdapter(broadcaster);
            invoke(adapter, "handleBeat", new FakeBeat());
            check(sink.messages.getLast().contains("\"beatWithinBar\":3"), "beat in bar");
            check(sink.messages.getLast().contains("\"trackBeat\":null"), "no invented absolute beat without status");
            invoke(adapter, "handleTrackMetadata", new MetadataUpdate(new Metadata(10)));
            check(sink.messages.getLast().contains("\"id\":10"), "track source retained");
            broadcaster.publish(new CanonicalEvent("art", 2, 1, Map.of("player", 1, "source", source(10), "jpg", "old")));
            invoke(adapter, "handleTrackMetadata", new MetadataUpdate(new Metadata(11)));
            var reconnect = new RecordingSink();
            broadcaster.add(reconnect);
            check(reconnect.messages.size() == 1 && reconnect.messages.getFirst().contains("\"id\":11"),
                    "reconnect snapshot excludes previous track artwork and beat");
            invoke(adapter, "handleTrackMetadata", new MetadataUpdate(null));
            check(sink.messages.getLast().contains("\"source\":null"), "metadata loss emits explicit clearing event");
            var unloaded = new RecordingSink();
            broadcaster.add(unloaded);
            check(unloaded.messages.size() == 1 && unloaded.messages.getFirst().contains("\"source\":null"), "unloaded snapshot");
            broadcaster.publish(new CanonicalEvent("device", 2, 2, Map.of("player", 1, "active", false, "name", "CDJ")));
            var lost = new RecordingSink();
            broadcaster.add(lost);
            check(lost.messages.size() == 1 && lost.messages.getFirst().contains("\"active\":false"), "device loss clears snapshot");
        } finally { Files.deleteIfExists(log); }
        System.out.println("Bridge regression checks passed.");
    }

    private static Map<String, Object> source(int id) { return Map.of("id", id, "player", 2, "slot", "USB_SLOT"); }
    private static void invoke(BeatLinkAdapter adapter, String name, Object update) throws Exception {
        Method method = BeatLinkAdapter.class.getDeclaredMethod(name, Method.class, Object.class);
        method.setAccessible(true);
        method.invoke(adapter, null, update);
    }
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    private static final class RecordingSink implements EventSink {
        final List<String> messages = new ArrayList<>();
        public void send(String message) { messages.add(message); }
        public void close() {}
    }
    public static final class FakeBeat {
        public int getDeviceNumber() { return 1; }
        public int getBeatWithinBar() { return 3; }
        public int getBeatNumber() { return 999; }
        public double getEffectiveTempo() { return 128; }
    }
    public static final class Reference {
        public final int rekordboxId;
        public final int player = 2;
        public final String slot = "USB_SLOT";
        Reference(int id) { rekordboxId = id; }
    }
    public static final class Metadata {
        public final Reference trackReference;
        Metadata(int id) { trackReference = new Reference(id); }
        public String getTitle() { return "Track"; }
    }
    public static final class MetadataUpdate {
        public final int player = 1;
        public final Metadata metadata;
        MetadataUpdate(Metadata value) { metadata = value; }
    }
}
