package com.prodjbeats.bridge;

import java.lang.reflect.Method;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Standalone tests using installed beat-link JARs; no hardware or network services required. */
public final class BridgeRegressionTest {
    public static void main(String[] args) throws Exception {
        BeatLinkAdapter.configurePlayerNumber(new RunningCdj());
        checkStandardNumberSelection();
        var service = new DelayedService();
        check(!BeatLinkAdapter.startService(service), "false startup must not be reported as success");
        check(BeatLinkAdapter.startService(service), "startup can be retried after a late device appears");
        check(BeatLinkAdapter.startService(new VoidService()), "void lifecycle startup remains supported");
        var log = Files.createTempFile("prodj-bridge-test", ".jsonl");
        try (var broadcaster = new EventBroadcaster(log)) {
            var sink = new RecordingSink();
            broadcaster.add(sink);
            var adapter = new BeatLinkAdapter(broadcaster);
            // Real decoder gets an isolated broadcaster so its snapshot cannot affect other tests.
            var decoderLog = Files.createTempFile("prodj-decoder-test", ".jsonl");
            try (var decoderBroadcaster = new EventBroadcaster(decoderLog)) {
                var decoderSink = new RecordingSink();
                decoderBroadcaster.add(decoderSink);
                checkRealMixerDecoder(new BeatLinkAdapter(decoderBroadcaster), decoderSink);
            } finally { Files.deleteIfExists(decoderLog); }
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

    /** Exercise the actual beat-link allocator against occupied numbers, without starting its services. */
    private static void checkStandardNumberSelection() throws Exception {
        Class<?> cdjType = Class.forName("org.deepsymmetry.beatlink.VirtualCdj");
        Object cdj = cdjType.getMethod("getInstance").invoke(null);
        Class<?> finderType = Class.forName("org.deepsymmetry.beatlink.DeviceFinder");
        Object finder = finderType.getMethod("getInstance").invoke(null);
        java.lang.reflect.Field deviceField = finderType.getDeclaredField("devices");
        deviceField.setAccessible(true);
        @SuppressWarnings("unchecked") Map<Object, Object> devices = (Map<Object, Object>) deviceField.get(finder);
        java.lang.reflect.Field socketField = finderType.getDeclaredField("socket");
        socketField.setAccessible(true);
        @SuppressWarnings("unchecked")
        var socket = (java.util.concurrent.atomic.AtomicReference<java.net.DatagramSocket>) socketField.get(finder);
        // isRunning checks presence only. A CLOSED, never-bound socket lets discovery expose fixtures.
        // No bind, receiver, announcements or traffic are started by this test.
        var closedSocket = new java.net.DatagramSocket((java.net.SocketAddress) null);
        closedSocket.close();
        java.lang.reflect.Field claimField = cdjType.getDeclaredField("claimingNumber");
        claimField.setAccessible(true);
        var claim = (java.util.concurrent.atomic.AtomicInteger) claimField.get(cdj);
        Method select = cdjType.getDeclaredMethod("selfAssignDeviceNumber");
        select.setAccessible(true);
        Class<?> announcementType = Class.forName("org.deepsymmetry.beatlink.DeviceAnnouncement");
        Class<?> referenceType = Class.forName("org.deepsymmetry.beatlink.DeviceReference");
        Method reference = referenceType.getMethod("getDeviceReference", announcementType);
        java.lang.reflect.Field firstTimeField = finderType.getDeclaredField("firstDeviceTime");
        firstTimeField.setAccessible(true);
        var firstTime = (java.util.concurrent.atomic.AtomicLong) firstTimeField.get(null);
        long previousFirstTime = firstTime.get();
        try {
            firstTime.set(System.currentTimeMillis() - 5000); // Discovery's observation window has elapsed.
            socket.set(closedSocket);
            for (int[] occupied : new int[][] { {1, 2, 33}, {1, 2, 3, 33}, {1, 2, 3, 4, 33} }) {
                devices.clear();
                for (int number : occupied) {
                    byte[] bytes = new byte[54];
                    bytes[36] = (byte) number;
                    Object announcement = announcementType.getConstructor(java.net.DatagramPacket.class).newInstance(
                            new java.net.DatagramPacket(bytes, bytes.length, java.net.InetAddress.getLoopbackAddress(), 50000));
                    devices.put(reference.invoke(null, announcement), announcement);
                }
                BeatLinkAdapter.configurePlayerNumber(cdj);
                check(Boolean.TRUE.equals(cdjType.getMethod("getUseStandardPlayerNumber").invoke(cdj)), "prefer standard number");
                check(((Number) cdjType.getMethod("getDeviceNumber").invoke(cdj)).intValue() == 0, "automatic allocation, no fixed deck number");
                claim.set(0);
                check(Boolean.TRUE.equals(select.invoke(cdj)), "free number can be allocated");
                int expected = occupied.length == 3 ? 3 : occupied.length == 4 ? 4 : 5;
                check(claim.get() == expected, "occupied numbers skipped, safe nonstandard fallback if 1-4 occupied");
                check(Boolean.FALSE.equals(cdjType.getMethod("isSendingStatus").invoke(cdj)), "own status sending remains off");
            }
            // No candidate remains: the allocator must fail rather than reuse an occupied number.
            for (int number = 1; number <= 15; number++) {
                byte[] bytes = new byte[54];
                bytes[36] = (byte) number;
                Object announcement = announcementType.getConstructor(java.net.DatagramPacket.class).newInstance(
                        new java.net.DatagramPacket(bytes, bytes.length, java.net.InetAddress.getLoopbackAddress(), 50000));
                devices.put(reference.invoke(null, announcement), announcement);
            }
            claim.set(0);
            check(Boolean.FALSE.equals(select.invoke(cdj)), "exhausted numbers are never reused");
        } finally {
            devices.clear();
            socket.set(null);
            firstTime.set(previousFirstTime);
            claim.set(0);
            cdjType.getMethod("setUseStandardPlayerNumber", boolean.class).invoke(cdj, false);
            cdjType.getMethod("setDeviceNumber", byte.class).invoke(cdj, (byte) 0);
        }
        check(Boolean.FALSE.equals(cdjType.getMethod("isRunning").invoke(cdj)), "no virtual CDJ started");
        check(Boolean.FALSE.equals(finderType.getMethod("isRunning").invoke(finder)), "no discovery service started");
    }

    /** Exercise beat-link's real packet decoder and our registered listener, without opening sockets. */
    private static void checkRealMixerDecoder(BeatLinkAdapter adapter, RecordingSink sink) throws Exception {
        Class<?> cdjType = Class.forName("org.deepsymmetry.beatlink.VirtualCdj");
        Object cdj = cdjType.getMethod("getInstance").invoke(null);
        adapter.registerStatusListener(cdj);
        adapter.registerStatusListener(cdj);
        check(((java.util.Set<?>) cdjType.getMethod("getUpdateListeners").invoke(cdj)).size() == 1,
                "status listener registered exactly once");
        byte[] bytes = new byte[56];
        System.arraycopy("Qspt1WmJOL".getBytes(java.nio.charset.StandardCharsets.US_ASCII), 0, bytes, 0, 10);
        bytes[10] = 0x29; // Mixer status on UDP 50002.
        System.arraycopy("XDJ-XZ".getBytes(java.nio.charset.StandardCharsets.US_ASCII), 0, bytes, 11, 6);
        bytes[0x21] = 33;
        bytes[0x23] = 20;
        bytes[0x24] = 33;
        bytes[0x27] = (byte) 0xd0;
        bytes[0x29] = 0x10; // Neutral pitch: 0x00100000.
        bytes[0x2e] = 0x36; bytes[0x2f] = (byte) 0xa6; // 139.90 BPM.
        bytes[0x36] = (byte) 0xff;
        bytes[0x37] = 3;
        Method decode = cdjType.getDeclaredMethod("buildUpdate", java.net.DatagramPacket.class);
        decode.setAccessible(true);
        Object status = decode.invoke(cdj, new java.net.DatagramPacket(bytes, bytes.length,
                java.net.InetAddress.getByName("192.168.178.47"), 50002));
        check(status.getClass().getSimpleName().equals("MixerStatus"), "real decoder recognizes mixer packet");
        Method deliver = cdjType.getDeclaredMethod("deliverDeviceUpdate", Class.forName("org.deepsymmetry.beatlink.DeviceUpdate"));
        deliver.setAccessible(true);
        deliver.invoke(cdj, status);
        check(sink.messages.getLast().contains("\"type\":\"mixer\"") &&
                sink.messages.getLast().contains("\"bpm\":139.9"), "decoded mixer reaches canonical bridge event");
        check(sink.messages.stream().anyMatch(message -> message.contains("decoded MixerStatus for device 33 (56 bytes)")),
                "reception diagnostic identifies decoded type and device");
        int count = sink.messages.size();
        deliver.invoke(cdj, status);
        check(sink.messages.size() == count + 1, "repeated packets do not flood diagnostic logs");
        for (Object listener : (java.util.Set<?>) cdjType.getMethod("getUpdateListeners").invoke(cdj))
            cdjType.getMethod("removeUpdateListener", Class.forName("org.deepsymmetry.beatlink.DeviceUpdateListener")).invoke(cdj, listener);
        check(!Boolean.TRUE.equals(cdjType.getMethod("isRunning").invoke(cdj)), "decoder test starts no network service");
        java.lang.reflect.Field ready = BeatLinkAdapter.class.getDeclaredField("servicesReady");
        ready.setAccessible(true);
        ready.setBoolean(adapter, true);
        java.lang.reflect.Field announced = BeatLinkAdapter.class.getDeclaredField("announcedAt");
        announced.setAccessible(true);
        @SuppressWarnings("unchecked")
        Map<Integer, Long> devices = (Map<Integer, Long>) announced.get(adapter);
        devices.put(33, 0L);
        devices.put(34, 0L);
        int before = sink.messages.size();
        adapter.reportMissingStatus(14999);
        check(sink.messages.size() == before, "missing status waits for grace period");
        adapter.reportMissingStatus(15000);
        check(sink.messages.size() == before + 1 && sink.messages.getLast().contains("Device 34 announced"),
                "diagnostic distinguishes announcements from decoded status");
        adapter.reportMissingStatus(30000);
        check(sink.messages.size() == before + 1, "missing-status diagnostic is not repeated");
    }

    public static final class RunningCdj {
        public boolean isRunning() { return true; }
        public void setUseStandardPlayerNumber(boolean value) { throw new AssertionError("must not reconfigure a running device"); }
        public void setDeviceNumber(byte value) { throw new AssertionError("must not change a running device number"); }
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
