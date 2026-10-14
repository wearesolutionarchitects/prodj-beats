package com.prodjbeats.bridge;

import java.lang.reflect.Method;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Standalone tests: no hardware, runtime JARs or test framework required. */
public final class BridgeRegressionTest {
    public static void main(String[] args) throws Exception {
        var service = new DelayedService();
        check(!BeatLinkAdapter.startService(service), "false startup must not be reported as success");
        check(BeatLinkAdapter.startService(service), "startup can be retried after a late device appears");
        check(BeatLinkAdapter.startService(new VoidService()), "void lifecycle startup remains supported");
        var log = Files.createTempFile("prodj-bridge-test", ".jsonl");
        try (var broadcaster = new EventBroadcaster(log)) {
            var sink = new RecordingSink();
            broadcaster.add(sink);
            var adapter = new BeatLinkAdapter(broadcaster);
            Method playback = BeatLinkAdapter.class.getDeclaredMethod("playbackStatus", Object.class, Map.class);
            playback.setAccessible(true);
            for (String state : List.of("playing", "paused", "cued", "ended", "stopped"))
                check(state.equals(playback.invoke(adapter, new FakeStatus(state), source(10))), "reported playback status: " + state);
            check("unknown".equals(playback.invoke(adapter, new FakeStatus("playing"), source(11))), "stale status rejected");
            check("unknown".equals(playback.invoke(adapter, null, source(10))), "missing status stays unknown");
            Method trackTime = BeatLinkAdapter.class.getDeclaredMethod("trackTime", Object.class, int.class, Map.class);
            trackTime.setAccessible(true);
            check(Long.valueOf(12345).equals(trackTime.invoke(adapter, new FakeTimeFinder(), 1, source(10))), "track time retains milliseconds");
            check(trackTime.invoke(adapter, new FakeTimeFinder(), 1, source(11)) == null, "previous track position is rejected");
            Method announcementHandler = BeatLinkAdapter.class.getDeclaredMethod("handleDeviceAnnouncement", Method.class, Object.class);
            announcementHandler.setAccessible(true);
            announcementHandler.invoke(adapter, FakeAnnouncement.class.getMethod("deviceFound"), new FakeAnnouncement());
            check(sink.messages.getLast().contains("\"address\":\"192.168.178.47\""), "device LAN address emitted");
            invoke(adapter, "handleBeat", new FakeBeat());
            check(sink.messages.getLast().contains("\"beatWithinBar\":3"), "beat in bar");
            check(sink.messages.getLast().contains("\"trackBeat\":null"), "no invented absolute beat without status");
            invoke(adapter, "handleTrackMetadata", new MetadataUpdate(new Metadata(10)));
            check(sink.messages.getLast().contains("\"id\":10"), "track source retained");
            broadcaster.publish(new CanonicalEvent("art", 2, 1, Map.of("player", 1, "source", source(10), "jpg", "old")));
            broadcaster.publish(new CanonicalEvent("position", 2, 2, Map.of("player", 1, "source", source(10), "positionMs", 12345)));
            var positioned = new RecordingSink();
            broadcaster.add(positioned);
            check(positioned.messages.stream().anyMatch(message -> message.contains("\"positionMs\":12345")), "reconnect includes position");
            invoke(adapter, "handleTrackMetadata", new MetadataUpdate(new Metadata(11)));
            var reconnect = new RecordingSink();
            broadcaster.add(reconnect);
            check(reconnect.messages.stream().anyMatch(message -> message.contains("\"id\":11")) &&
                    reconnect.messages.stream().noneMatch(message -> message.contains("\"jpg\":\"old\"") || message.contains("\"type\":\"beat\"") || message.contains("\"type\":\"position\"")),
                    "reconnect snapshot excludes previous track artwork and beat");
            invoke(adapter, "handleTrackMetadata", new MetadataUpdate(null));
            check(sink.messages.getLast().contains("\"source\":null"), "metadata loss emits explicit clearing event");
            var unloaded = new RecordingSink();
            broadcaster.add(unloaded);
            check(unloaded.messages.stream().anyMatch(message -> message.contains("\"source\":null")), "unloaded snapshot");
            broadcaster.publish(new CanonicalEvent("device", 2, 2, Map.of("player", 1, "active", false, "name", "CDJ")));
            var lost = new RecordingSink();
            broadcaster.add(lost);
            check(lost.messages.size() == 1 && lost.messages.getFirst().contains("\"active\":false"), "device loss clears snapshot");
            adapter.publishMixerStatus(new FakeMixer());
            check(sink.messages.getLast().contains("\"bpm\":139.9") &&
                    sink.messages.getLast().contains("\"beatMeaningful\":false"), "mixer mapping and reliability");
            var mixerReconnect = new RecordingSink();
            broadcaster.add(mixerReconnect);
            check(mixerReconnect.messages.stream().anyMatch(message -> message.contains("\"type\":\"mixer\"")), "reconnect includes mixer status");
            broadcaster.publish(new CanonicalEvent("device", 2, 3, Map.of("player", 33, "active", false, "name", "XDJ-XZ")));
            var mixerLost = new RecordingSink();
            broadcaster.add(mixerLost);
            check(mixerLost.messages.stream().noneMatch(message -> message.contains("\"type\":\"mixer\"")), "lost mixer clears cached status");
        } finally { Files.deleteIfExists(log); }
        System.out.println("Bridge regression checks passed.");
    }

    public static final class FakeMixer {
        public int getDeviceNumber() { return 33; }
        public int getBpm() { return 13990; }
        public double getEffectiveTempo() { return 139.9; }
        public int getPitch() { return 1048576; }
        public int getBeatWithinBar() { return 1; }
        public boolean isBeatWithinBarMeaningful() { return false; }
        public boolean isTempoMaster() { return false; }
        public boolean isSynced() { return true; }
        public Integer getDeviceMasterIsBeingYieldedTo() { return null; }
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
    public static final class FakeStatus {
        private final String state;
        FakeStatus(String state) { this.state = state; }
        public int getRekordboxId() { return 10; }
        public int getTrackSourcePlayer() { return 2; }
        public String getTrackSourceSlot() { return "USB_SLOT"; }
        public boolean isPlaying() { return state.equals("playing"); }
        public boolean isPaused() { return state.equals("paused"); }
        public boolean isCued() { return state.equals("cued"); }
        public boolean isAtEnd() { return state.equals("ended"); }
        public boolean isTrackLoaded() { return true; }
    }
    public static final class FakeTimeFinder {
        public FakePosition getLatestPositionFor(int player) { return new FakePosition(); }
        public long getTimeFor(int player) { return 12345; }
    }
    public static final class FakePosition {
        public final FakeGrid beatGrid = new FakeGrid();
    }
    public static final class FakeGrid {
        public final Reference dataReference = new Reference(10);
    }
    public static final class FakeAnnouncement {
        public void deviceFound() {}
        public int getDeviceNumber() { return 1; }
        public String getDeviceName() { return "XDJ-XZ"; }
        public java.net.InetAddress getAddress() throws Exception { return java.net.InetAddress.getByName("192.168.178.47"); }
    }
    public static final class DelayedService {
        private int attempts;
        public boolean start() { return ++attempts > 1; }
    }
    public static final class VoidService {
        public void start() {}
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
