package com.prodjbeats.bridge;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.ByteBuffer;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;
import java.util.Collection;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

final class BeatLinkAdapter implements AutoCloseable {
    private final EventBroadcaster broadcaster;
    private final Set<String> registeredListeners = new HashSet<>();
    private final ScheduledExecutorService startup = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "beat-link-startup");
        thread.setDaemon(true);
        return thread;
    });
    private final Map<Integer, String> waveformSources = new HashMap<>();
    private final Map<Integer, Long> waveformSampleAt = new HashMap<>();
    private final Map<Integer, Integer> waveformSampleCount = new HashMap<>();
    private final Set<Integer> waveformMissing = new HashSet<>();
    private final Map<Integer, Map<String, Object>> waveformPublished = new HashMap<>();
    private boolean servicesReady;
    private Object currentMaster;
    private final Map<Integer, Long> announcedAt = new HashMap<>();
    private final Map<Integer, Long> statusReceivedAt = new HashMap<>();
    private final Set<String> statusTypesReceived = new HashSet<>();
    private final Set<Integer> missingStatusReported = new HashSet<>();
    private final Map<Integer, Map<String, Object>> sourcesByPlayer = new HashMap<>();

    BeatLinkAdapter(EventBroadcaster broadcaster) {
        this.broadcaster = broadcaster;
    }

    void start() {
        broadcaster.publish(CanonicalEvent.sys(202, "Waiting for players, status and metadata services"));
        startup.scheduleWithFixedDelay(this::startServices, 0, 5, TimeUnit.SECONDS);
        startup.scheduleWithFixedDelay(this::publishPositions, 0, 250, TimeUnit.MILLISECONDS);
        startup.scheduleWithFixedDelay(() -> reportMissingStatus(System.currentTimeMillis()), 15, 15, TimeUnit.SECONDS);
    }

    private void startServices() {
        try {
            startDeviceFinder();
            startBeatFinder();
            Object virtualCdj = singleton("org.deepsymmetry.beatlink.VirtualCdj");
            registerStatusListener(virtualCdj);
            registerMasterListener(virtualCdj);
            if (!Boolean.TRUE.equals(firstValue(virtualCdj, "isRunning"))) {
                servicesReady = false;
                Object devices = firstValue(singleton("org.deepsymmetry.beatlink.DeviceFinder"), "getCurrentDevices");
                if (!(devices instanceof Collection<?> found) || found.isEmpty()) return;
                configurePlayerNumber(virtualCdj);
                if (!startService(virtualCdj)) {
                    broadcaster.publish(CanonicalEvent.sys(503, "VirtualCdj could not start; retrying"));
                    return;
                }
            }
            if (!servicesReady) {
                startMetadataServices();
                invokeIfPresent(singleton("org.deepsymmetry.beatlink.data.TimeFinder"), "start");
                servicesReady = true;
                int number = intValue(virtualCdj, "getDeviceNumber");
                broadcaster.publish(CanonicalEvent.sys(200, "ProDJ Link registration: player " + number +
                        ", standard player number " + (number >= 1 && number <= 4 ? "selected" : "unavailable (fallback)") +
                        ", own status sending=" + booleanValue(virtualCdj, "isSendingStatus") +
                        ", address=" + stringValue(virtualCdj, "getLocalAddress")));
                broadcaster.publish(CanonicalEvent.sys(200, "beat-link status and metadata services started"));
            }
        } catch (ReflectiveOperationException | RuntimeException ex) {
            reportStartupError(ex);
        } finally {
            try { publishDiagnostics(singleton("org.deepsymmetry.beatlink.VirtualCdj")); }
            catch (ReflectiveOperationException | RuntimeException ignored) { /* Startup error already reported. */ }
        }
    }

    private synchronized void publishPositions() {
        if (!servicesReady) return;
        try {
            Object finder = singleton("org.deepsymmetry.beatlink.data.TimeFinder");
            for (Map.Entry<Integer, Map<String, Object>> entry : sourcesByPlayer.entrySet()) {
                int player = entry.getKey();
                Long milliseconds = trackTime(finder, player, entry.getValue());
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("player", player);
                payload.put("source", entry.getValue());
                payload.put("positionMs", milliseconds);
                publishWaveform(player, entry.getValue());
                diagnoseWaveform(player, entry.getValue(), milliseconds);
                Object cdj = singleton("org.deepsymmetry.beatlink.VirtualCdj");
                Object status = cdj.getClass().getMethod("getLatestStatusFor", int.class).invoke(cdj, player);
                payload.put("playbackStatus", playbackStatus(status, entry.getValue()));
                broadcaster.publish(new CanonicalEvent("position", 2, System.currentTimeMillis(), payload));
            }
        } catch (ReflectiveOperationException | RuntimeException ex) {
            broadcaster.publish(CanonicalEvent.error("Unable to read track position: " + describe(ex)));
        }
    }

    // 150 detail segments per second, as specified by beat-link WaveformDetail.
    // Reject unknown positions and end-of-track rather than clamping to a stale peak.
    static int waveformIndex(Long positionMs, int frames) {
        if (positionMs == null || positionMs < 0 || frames <= 0) return -1;
        if (positionMs >= (frames * 1000L + 149) / 150) return -1;
        return (int) (positionMs * 150 / 1000);
    }

    // Export track analysis once per load; subsequent positions only read the cache.
    private void publishWaveform(int player, Map<String, Object> source) {
        if (source.equals(waveformPublished.get(player))) return;
        try {
            Object finder = singleton("org.deepsymmetry.beatlink.data.WaveformFinder");
            Object detail = finder.getClass().getMethod("getLatestDetailFor", int.class).invoke(finder, player);
            if (detail == null || !source.equals(sourcePayload(fieldValue(detail, "dataReference")))) return;
            // Unsupported formats remain unknown instead of inventing amplitudes.
            if ("THREE_BAND".equals(String.valueOf(fieldValue(detail, "style")))) return;
            List<Integer> heights = waveformHeights(detail);
            if (heights.isEmpty()) return;
            broadcaster.publish(new CanonicalEvent("waveformData", 2, System.currentTimeMillis(),
                    Map.of("player", player, "source", source, "data", Map.of("sampleMs", 50, "heights", heights))));
            waveformPublished.put(player, Map.copyOf(source));
        } catch (ReflectiveOperationException | RuntimeException ex) {
            if (waveformMissing.add(player)) broadcaster.logWaveformDiagnostic("[waveform] export unavailable: " + describe(ex));
        }
    }

    static List<Integer> waveformHeights(Object detail) throws ReflectiveOperationException {
        int frames = ((Number) detail.getClass().getMethod("getFrameCount").invoke(detail)).intValue();
        int count = (int) ((frames * 20L + 149) / 150);
        if (count <= 0 || count > 144000) return List.of();
        Method height = detail.getClass().getMethod("segmentHeight", int.class, int.class);
        List<Integer> heights = new ArrayList<>(count);
        for (int bin = 0; bin < count; bin++) {
            int start = (bin * 150 + 19) / 20;
            int end = Math.min(frames, ((bin + 1) * 150 + 19) / 20);
            int peak = 0;
            for (int index = start; index < end; index++) peak = Math.max(peak, ((Number) height.invoke(detail, index, 1)).intValue());
            heights.add(Math.max(0, Math.min(31, peak)));
        }
        return heights;
    }

    private void diagnoseWaveform(int player, Map<String, Object> source, Long positionMs) {
        String identity = source.toString();
        if (!identity.equals(waveformSources.put(player, identity))) {
            waveformSampleAt.remove(player);
            waveformSampleCount.remove(player);
            waveformMissing.remove(player);
        }
        if (waveformSampleCount.getOrDefault(player, 0) >= 3) return;
        try {
            Object finder = singleton("org.deepsymmetry.beatlink.data.WaveformFinder");
            Object detail = finder.getClass().getMethod("getLatestDetailFor", int.class).invoke(finder, player);
            if (detail == null || !source.equals(sourcePayload(fieldValue(detail, "dataReference")))) {
                if (waveformMissing.add(player)) broadcaster.logWaveformDiagnostic("[waveform] player=" + player + " detail=pending (no matching track waveform yet)");
                return;
            }
            int frames = ((Number) detail.getClass().getMethod("getFrameCount").invoke(detail)).intValue();
            long duration = ((Number) detail.getClass().getMethod("getTotalTime").invoke(detail)).longValue();
            int index = waveformIndex(positionMs, frames);
            long now = System.currentTimeMillis();
            if (now - waveformSampleAt.getOrDefault(player, 0L) < 2000) return;
            String height = "unavailable";
            if (index >= 0) {
                // The two-argument height accessor is unavailable for three-band data.
                if (!"THREE_BAND".equals(String.valueOf(fieldValue(detail, "style")))) {
                    height = String.valueOf(detail.getClass().getMethod("segmentHeight", int.class, int.class).invoke(detail, index, 1));
                }
            }
            broadcaster.logWaveformDiagnostic("[waveform] player=" + player + " source=" + source + " detail=available frames=" + frames
                    + " durationMs=" + duration + " positionMs=" + positionMs + " segment=" + index
                    + " height=" + height + " identity=matched mapping=" + (index >= 0 ? "valid" : "waiting-for-position"));
            waveformSampleAt.put(player, now);
            // Keep waiting if TimeFinder has not resolved the matching position yet.
            if (index >= 0) waveformSampleCount.merge(player, 1, Integer::sum);
        } catch (ReflectiveOperationException | RuntimeException ex) {
            if (waveformMissing.add(player)) broadcaster.logWaveformDiagnostic("[waveform] player=" + player + " diagnostic unavailable: " + describe(ex));
        }
    }

    private String playbackStatus(Object status, Map<String, Object> source) {
        // Status must describe the loaded track, not an earlier load on this deck.
        if (intValue(status, "getRekordboxId") != ((Number) source.get("id")).intValue() ||
                intValue(status, "getTrackSourcePlayer") != ((Number) source.get("player")).intValue() ||
                !source.get("slot").equals(stringValue(status, "getTrackSourceSlot"))) return "unknown";
        if (Boolean.TRUE.equals(booleanValue(status, "isPlaying"))) return "playing";
        if (Boolean.TRUE.equals(booleanValue(status, "isCued"))) return "cued";
        if (Boolean.TRUE.equals(booleanValue(status, "isAtEnd"))) return "ended";
        if (Boolean.TRUE.equals(booleanValue(status, "isPaused"))) return "paused";
        return Boolean.TRUE.equals(booleanValue(status, "isTrackLoaded")) ? "stopped" : "unknown";
    }

    private Long trackTime(Object finder, int player, Map<String, Object> source) throws ReflectiveOperationException {
        Object position = finder.getClass().getMethod("getLatestPositionFor", int.class).invoke(finder, player);
        Map<String, Object> reference = sourcePayload(fieldValue(fieldValue(position, "beatGrid"), "dataReference"));
        if (!source.equals(reference)) return null;
        long time = ((Number) finder.getClass().getMethod("getTimeFor", int.class).invoke(finder, player)).longValue();
        return time >= 0 ? time : null;
    }

    // Leave discovery, conflict handling and fallback to beat-link; never hard-code deck 3 or 4.
    static void configurePlayerNumber(Object virtualCdj) throws ReflectiveOperationException {
        if (Boolean.TRUE.equals(virtualCdj.getClass().getMethod("isRunning").invoke(virtualCdj))) return;
        virtualCdj.getClass().getMethod("setUseStandardPlayerNumber", boolean.class).invoke(virtualCdj, true);
        virtualCdj.getClass().getMethod("setDeviceNumber", byte.class).invoke(virtualCdj, (byte) 0);
        // No setSendingStatus(true): we remain a monitor, without participating in tempo control.
    }

    // Some beat-link services return false instead of throwing when startup fails.
    static boolean startService(Object service) throws ReflectiveOperationException {
        return !Boolean.FALSE.equals(service.getClass().getMethod("start").invoke(service));
    }

    private void reportStartupError(Exception ex) {
        if (ex instanceof ClassNotFoundException) {
            broadcaster.publish(CanonicalEvent.sys(503, "beat-link jars not found; run npm run bridge:deps"));
            startup.shutdown();
            return;
        }
        Throwable cause = ex instanceof InvocationTargetException && ex.getCause() != null ? ex.getCause() : ex;
        broadcaster.publish(CanonicalEvent.error("Unable to start beat-link services: " + describe(cause)));
    }

    @Override
    public void close() {
        startup.shutdownNow();
    }

    private void startDeviceFinder() throws ReflectiveOperationException {
        Object finder = singleton("org.deepsymmetry.beatlink.DeviceFinder");
        registerListener(
                finder,
                "addDeviceAnnouncementListener",
                "org.deepsymmetry.beatlink.DeviceAnnouncementListener",
                this::handleDeviceAnnouncement
        );
        invokeIfPresent(finder, "start");
    }

    private void startBeatFinder() throws ReflectiveOperationException {
        Object finder = singleton("org.deepsymmetry.beatlink.BeatFinder");
        registerListener(
                finder,
                "addBeatListener",
                "org.deepsymmetry.beatlink.BeatListener",
                this::handleBeat
        );
        registerOnAirListener(finder);
        invokeIfPresent(finder, "start");
    }

    void registerOnAirListener(Object finder) throws ReflectiveOperationException {
        registerListener(finder, "addOnAirListener", "org.deepsymmetry.beatlink.OnAirListener", this::handleOnAir);
    }

    private synchronized void handleOnAir(Method method, Object channels) {
        if (!(channels instanceof Set<?> reported) || announcedAt.isEmpty()) return;
        List<Integer> audible = reported.stream().filter(Integer.class::isInstance).map(Integer.class::cast)
                .filter(channel -> channel >= 1 && channel <= 6).sorted().toList();
        broadcaster.publish(new CanonicalEvent("onAir", 2, System.currentTimeMillis(), Map.of("channels", audible)));
    }

    private void startMetadataServices() throws ReflectiveOperationException {
        Object metadataFinder = singleton("org.deepsymmetry.beatlink.data.MetadataFinder");
        registerListener(
                metadataFinder,
                "addTrackMetadataListener",
                "org.deepsymmetry.beatlink.data.TrackMetadataListener",
                this::handleTrackMetadata
        );
        // CrateDigger can start MetadataFinder itself, so subscribe before either starts.
        Object crateDigger = singleton("org.deepsymmetry.beatlink.data.CrateDigger");
        invokeIfPresent(crateDigger, "start");
        invokeIfPresent(metadataFinder, "start");

        Object artFinder = singleton("org.deepsymmetry.beatlink.data.ArtFinder");
        registerListener(
                artFinder,
                "addAlbumArtListener",
                "org.deepsymmetry.beatlink.data.AlbumArtListener",
                this::handleAlbumArt
        );
        invokeIfPresent(artFinder, "start");

        Object analysisTagFinder = singleton("org.deepsymmetry.beatlink.data.AnalysisTagFinder");
        registerAnalysisTagListener(
                analysisTagFinder,
                ".EXT",
                "PSSI",
                this::handleStructure
        );
        invokeIfPresent(analysisTagFinder, "start");

        // Read-only analysis requests through the existing beat-link connection.
        Object waveformFinder = singleton("org.deepsymmetry.beatlink.data.WaveformFinder");
        waveformFinder.getClass().getMethod("setFindDetails", boolean.class).invoke(waveformFinder, true);
        invokeIfPresent(waveformFinder, "start");
    }

    private void registerAnalysisTagListener(
            Object target,
            String fileExtension,
            String typeTag,
            ReflectedEventHandler handler
    ) throws ReflectiveOperationException {
        String key = target.getClass().getName() + fileExtension + typeTag;
        if (registeredListeners.contains(key)) return;
        Class<?> listenerClass = Class.forName("org.deepsymmetry.beatlink.data.AnalysisTagListener");
        InvocationHandler invocationHandler = (proxy, method, args) -> {
            if (method.getDeclaringClass().equals(Object.class)) {
                return handleObjectMethod(proxy, method, args);
            }

            if (args != null && args.length == 1 && method.getReturnType().equals(Void.TYPE)) {
                handler.handle(method, args[0]);
            }
            return defaultValue(method.getReturnType());
        };
        Object listener = Proxy.newProxyInstance(
                listenerClass.getClassLoader(),
                new Class<?>[] { listenerClass },
                invocationHandler
        );
        target.getClass()
                .getMethod("addAnalysisTagListener", listenerClass, String.class, String.class)
                .invoke(target, listener, fileExtension, typeTag);
        registeredListeners.add(key);
    }

    private void registerListener(
            Object target,
            String methodName,
            String listenerClassName,
            ReflectedEventHandler handler
    ) throws ReflectiveOperationException {
        String key = target.getClass().getName() + methodName;
        if (registeredListeners.contains(key)) return;
        Class<?> listenerClass = Class.forName(listenerClassName);
        InvocationHandler invocationHandler = (proxy, method, args) -> {
            if (method.getDeclaringClass().equals(Object.class)) {
                return handleObjectMethod(proxy, method, args);
            }

            if (args != null && args.length == 1 && method.getReturnType().equals(Void.TYPE)) {
                handler.handle(method, args[0]);
            }
            return defaultValue(method.getReturnType());
        };
        Object listener = Proxy.newProxyInstance(
                listenerClass.getClassLoader(),
                new Class<?>[] { listenerClass },
                invocationHandler
        );
        target.getClass().getMethod(methodName, listenerClass).invoke(target, listener);
        registeredListeners.add(key);
    }

    private synchronized void handleDeviceAnnouncement(Method method, Object announcement) {
        String name = stringValue(announcement, "getDeviceName", "getName");
        int player = intValue(announcement, "getDeviceNumber", "getDevice", "getPlayer");

        if (player <= 0) {
            broadcaster.publish(CanonicalEvent.sys(202, "Ignored device event without player number"));
            return;
        }

        if (method.getName().toLowerCase().contains("lost")) {
            sourcesByPlayer.remove(player);
            waveformPublished.remove(player);
            announcedAt.remove(player);
            statusReceivedAt.remove(player);
            missingStatusReported.remove(player);
            statusTypesReceived.removeIf(key -> key.startsWith(player + ":"));
        } else {
            announcedAt.putIfAbsent(player, System.currentTimeMillis());
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("active", !method.getName().toLowerCase().contains("lost"));
        payload.put("name", name == null ? "Unknown Device" : name);
        payload.put("player", player);
        Object address = firstValue(announcement, "getAddress");
        payload.put("address", address instanceof InetAddress ip ? ip.getHostAddress() : null);
        if (method.getName().toLowerCase().contains("lost") && currentMaster != null &&
                player == intValue(currentMaster, "getDeviceNumber")) {
            currentMaster = null;
            publishMaster(null, null, null);
        }
        broadcaster.publish(new CanonicalEvent("device", 2, System.currentTimeMillis(), payload));
        if (!Boolean.TRUE.equals(payload.get("active"))) {
            Map<String, Object> unknown = new LinkedHashMap<>();
            unknown.put("channels", null);
            broadcaster.publish(new CanonicalEvent("onAir", 2, System.currentTimeMillis(), unknown));
        }
    }

    void registerStatusListener(Object virtualCdj) throws ReflectiveOperationException {
        registerListener(virtualCdj, "addUpdateListener",
                "org.deepsymmetry.beatlink.DeviceUpdateListener", this::handleMixerStatus);
    }

    private synchronized void handleMixerStatus(Method method, Object status) {
        if (status == null) return;
        int player = intValue(status, "getDeviceNumber");
        String type = status.getClass().getSimpleName();
        statusReceivedAt.put(player, System.currentTimeMillis());
        if (statusTypesReceived.add(player + ":" + type)) {
            Object bytes = firstValue(status, "getPacketBytes");
            broadcaster.publish(CanonicalEvent.sys(200, "beat-link decoded " + type +
                    " for device " + player + " (" + (bytes instanceof byte[] packet ? packet.length : "unknown") +
                    " bytes) from " + stringValue(status, "getAddress")));
        }
        if (type.equals("MixerStatus")) publishMixerStatus(status);
        if (currentMaster != null && player == intValue(currentMaster, "getDeviceNumber")) {
            currentMaster = status;
            publishMaster(status, null, null);
        }
    }

    synchronized void publishDiagnostics(Object virtualCdj) {
        boolean running = Boolean.TRUE.equals(booleanValue(virtualCdj, "isRunning"));
        Object local = running ? firstValue(virtualCdj, "getLocalAddress") : null;
        InetAddress address = local instanceof InetAddress ip ? ip : null;
        NetworkInterface selected = null;
        try { if (address != null) selected = NetworkInterface.getByInetAddress(address); }
        catch (SocketException ignored) { }
        List<Map<String, Object>> interfaces = new ArrayList<>();
        Object matching = running ? firstValue(virtualCdj, "getMatchingInterfaces") : null;
        if (matching instanceof Collection<?> candidates) for (Object candidate : candidates) {
            if (!(candidate instanceof NetworkInterface network)) continue;
            interfaces.add(Map.of("name", network.getName(), "label", network.getDisplayName(),
                    "addresses", network.inetAddresses().map(InetAddress::getHostAddress)
                            .filter(ip -> !ip.contains(":")).toList()));
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("running", running);
        payload.put("address", address == null ? null : address.getHostAddress());
        payload.put("interfaceName", selected == null ? null : selected.getName());
        payload.put("interfaceLabel", selected == null ? null : selected.getDisplayName());
        int player = running ? intValue(virtualCdj, "getDeviceNumber") : -1;
        payload.put("player", player > 0 ? player : null);
        payload.put("sendingStatus", running ? booleanValue(virtualCdj, "isSendingStatus") : null);
        payload.put("interfaces", interfaces);
        payload.put("statuses", statusReceivedAt.entrySet().stream().sorted(Map.Entry.comparingByKey())
                .map(entry -> Map.of("player", entry.getKey(), "receivedAt", entry.getValue())).toList());
        broadcaster.publish(new CanonicalEvent("diagnostics", 2, System.currentTimeMillis(), payload));
    }

    synchronized void reportMissingStatus(long now) {
        if (!servicesReady) return;
        for (Map.Entry<Integer, Long> entry : announcedAt.entrySet()) {
            int player = entry.getKey();
            if (now - entry.getValue() >= 15000 && !statusReceivedAt.containsKey(player) && missingStatusReported.add(player)) {
                broadcaster.publish(CanonicalEvent.sys(202, "Device " + player +
                        " announced, but no status decoded by beat-link after 15 seconds; " +
                        "this does not prove that no packets were sent"));
            }
        }
    }

    void registerMasterListener(Object virtualCdj) throws ReflectiveOperationException {
        registerListener(virtualCdj, "addMasterListener", "org.deepsymmetry.beatlink.MasterListener",
                this::handleMaster);
    }

    private synchronized void handleMaster(Method method, Object value) {
        switch (method.getName()) {
            case "masterChanged" -> {
                currentMaster = value;
                publishMaster(value, null, null);
            }
            case "tempoChanged" -> {
                if (currentMaster != null && value instanceof Number tempo)
                    publishMaster(currentMaster, tempo.doubleValue(), null);
            }
            case "newBeat" -> {
                if (currentMaster != null && intValue(value, "getDeviceNumber") == intValue(currentMaster, "getDeviceNumber"))
                    publishMaster(currentMaster, doubleValue(value, "getEffectiveTempo"), intValue(value, "getBeatWithinBar"));
            }
            default -> { }
        }
    }

    void publishMaster(Object status, Double tempo, Integer beat) {
        Map<String, Object> payload = statusPayload(status);
        payload.remove("master");
        Object meaningful = payload.remove("beatMeaningful");
        payload.put("handoff", payload.remove("masterHandoff"));
        if (status == null) payload.put("player", null);
        payload.put("bpmOnlySynced", booleanValue(status, "isBpmOnlySynced"));
        if (tempo != null) payload.put("tempo", Double.isFinite(tempo) && tempo > 0 ? tempo : null);
        if (beat != null) payload.put("beatWithinBar", Boolean.TRUE.equals(meaningful) && beat >= 1 && beat <= 4 ? beat : null);
        else if (!Boolean.TRUE.equals(meaningful)) payload.put("beatWithinBar", null);
        Object handoff = payload.get("handoff");
        if (!(handoff instanceof Number number) || number.intValue() <= 0 || number.intValue() == 255 ||
                handoff.equals(payload.get("player"))) payload.put("handoff", null);
        broadcaster.publish(new CanonicalEvent("master", 2, System.currentTimeMillis(), payload));
    }

    // Separate mapping also permits regression checks without runtime beat-link JARs.
    void publishMixerStatus(Object status) {
        int player = intValue(status, "getDeviceNumber");
        if (player <= 0) return;
        broadcaster.publish(new CanonicalEvent("mixer", 2, System.currentTimeMillis(), statusPayload(status)));
    }

    private Map<String, Object> statusPayload(Object status) {
        int player = intValue(status, "getDeviceNumber");
        int bpm = intValue(status, "getBpm");
        double tempo = doubleValue(status, "getEffectiveTempo");
        int pitch = intValue(status, "getPitch");
        int beat = intValue(status, "getBeatWithinBar");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("player", player);
        payload.put("bpm", bpm > 0 && bpm != 65535 ? bpm / 100.0 : null);
        payload.put("tempo", bpm > 0 && bpm != 65535 && Double.isFinite(tempo) && tempo > 0 ? tempo : null);
        payload.put("pitchPercent", pitch > 0 ? (pitch / 1048576.0 - 1) * 100 : null);
        payload.put("master", booleanValue(status, "isTempoMaster"));
        payload.put("synced", booleanValue(status, "isSynced"));
        payload.put("beatWithinBar", beat >= 1 && beat <= 4 ? beat : null);
        payload.put("beatMeaningful", booleanValue(status, "isBeatWithinBarMeaningful"));
        payload.put("masterHandoff", firstValue(status, "getDeviceMasterIsBeingYieldedTo"));
        return payload;
    }

    private synchronized void handleBeat(Method method, Object beat) {
        int player = intValue(beat, "getDeviceNumber", "getDevice", "getPlayer");
        if (player <= 0) return;
        int beatWithinBar = intValue(beat, "getBeatWithinBar");
        double tempo = doubleValue(beat, "getEffectiveTempo", "getBpm");
        Object status = latestStatusFor(beat);
        int beatNumber = intValue(status, "getBeatNumber");
        Boolean master = booleanValue(status, "isTempoMaster");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("beatWithinBar", beatWithinBar >= 1 && beatWithinBar <= 4 ? beatWithinBar : null);
        payload.put("trackBeat", beatNumber > 0 ? beatNumber : null);
        payload.put("master", master);
        payload.put("onAir", booleanValue(status, "isOnAir"));
        payload.put("player", Math.max(0, player));
        payload.put("tempo", tempo);

        broadcaster.publish(new CanonicalEvent(
                "beat",
                2,
                System.currentTimeMillis(),
                payload
        ));
    }

    private synchronized void handleTrackMetadata(Method method, Object update) {
        int player = intFieldValue(update, "player");
        if (player <= 0) return;
        publishTrack(player, fieldValue(update, "metadata"));
    }

    private void publishTrack(int player, Object metadata) {
        Map<String, Object> source = sourcePayload(fieldValue(metadata, "trackReference"));
        if (source == null) {
            sourcesByPlayer.remove(player);
            waveformPublished.remove(player);
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("player", player);
            payload.put("source", null);
            broadcaster.publish(new CanonicalEvent("track", 2, System.currentTimeMillis(), payload));
            return;
        }
        if (!source.equals(sourcesByPlayer.get(player))) waveformPublished.remove(player);
        sourcesByPlayer.put(player, source);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("album", searchableLabel(firstValue(metadata, "getAlbum")));
        payload.put("artist", searchableLabel(firstValue(metadata, "getArtist")));
        payload.put("cues", List.of());
        payload.put("duration", durationMillis(intValue(metadata, "getDuration")));
        payload.put("player", Math.max(0, player));
        payload.put("source", source);
        payload.put("tempo", normalizedTempo(intValue(metadata, "getTempo")));
        payload.put("title", stringValue(metadata, "getTitle"));
        payload.put("year", nullablePositive(intValue(metadata, "getYear")));

        broadcaster.publish(new CanonicalEvent("track", 2, System.currentTimeMillis(), payload));
    }

    private synchronized void handleAlbumArt(Method method, Object update) {
        int player = intFieldValue(update, "player");
        Object metadata = currentMetadata(player);
        Map<String, Object> source = sourcePayload(fieldValue(metadata, "trackReference"));
        if (source == null) return;
        Object art = fieldValue(update, "art");
        // Artwork IDs are not track IDs. Match against metadata's artwork reference.
        if (art != null) {
            Map<String, Object> reference = sourcePayload(fieldValue(art, "artReference"));
            if (reference == null || !reference.get("player").equals(source.get("player")) ||
                    !reference.get("slot").equals(source.get("slot")) ||
                    !reference.get("id").equals(intValue(metadata, "getArtworkId"))) return;
        }
        ensureTrack(player, metadata, source);
        if (art == null) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("player", player);
            payload.put("source", source);
            payload.put("jpg", null);
            broadcaster.publish(new CanonicalEvent("art", 2, System.currentTimeMillis(), payload));
            return;
        }

        Object rawBytes = firstValue(art, "getRawBytes");
        if (!(rawBytes instanceof ByteBuffer byteBuffer)) {
            return;
        }

        ByteBuffer duplicate = byteBuffer.duplicate();
        byte[] bytes = new byte[duplicate.remaining()];
        duplicate.get(bytes);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("source", source);
        payload.put("jpg", Base64.getEncoder().encodeToString(bytes));
        payload.put("player", Math.max(0, intFieldValue(update, "player")));

        broadcaster.publish(new CanonicalEvent("art", 2, System.currentTimeMillis(), payload));
    }

    private synchronized void handleStructure(Method method, Object update) {
        int player = intFieldValue(update, "player");
        Object taggedSection = fieldValue(update, "taggedSection");
        Map<String, Object> source = analysisSource(player, taggedSection);
        Object metadata = currentMetadata(player);
        if (source == null || !source.equals(sourcePayload(fieldValue(metadata, "trackReference")))) return;
        ensureTrack(player, metadata, source);
        Object songStructureTag = firstValue(taggedSection, "body");
        Object body = firstValue(songStructureTag, "body");
        Object entries = firstValue(body, "entries");

        if (!(entries instanceof List<?> phrases)) {
            return;
        }

        int endBeat = intValue(body, "endBeat");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("source", source);
        payload.put("bank", enumName(firstValue(body, "bank")));
        payload.put("mood", enumName(firstValue(body, "mood")));
        List<Map<String, Object>> structurePhrases = structurePhrases(phrases, endBeat);
        payload.put("phrases", structurePhrases);
        payload.put("player", Math.max(0, player));

        broadcaster.publish(new CanonicalEvent("structure", 2, System.currentTimeMillis(), payload));
    }

    private Object singleton(String className) throws ReflectiveOperationException {
        Class<?> type = Class.forName(className);
        return type.getMethod("getInstance").invoke(null);
    }

    private void invokeIfPresent(Object target, String methodName) throws ReflectiveOperationException {
        try {
            target.getClass().getMethod(methodName).invoke(target);
        } catch (NoSuchMethodException ignored) {
            broadcaster.publish(CanonicalEvent.sys(202, target.getClass().getSimpleName() + "." + methodName + " not found"));
        }
    }

    private String stringValue(Object target, String... methodNames) {
        Object value = firstValue(target, methodNames);
        return value == null ? null : value.toString();
    }

    private static int intValue(Object target, String... methodNames) {
        Object value = firstValue(target, methodNames);
        if (value instanceof Number number) {
            return number.intValue();
        }
        return -1;
    }

    private double doubleValue(Object target, String... methodNames) {
        Object value = firstValue(target, methodNames);
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        return 0.0;
    }

    private Boolean booleanValue(Object target, String... methodNames) {
        Object value = firstValue(target, methodNames);
        return value instanceof Boolean bool ? bool : null;
    }

    private Object fieldValue(Object target, String fieldName) {
        if (target == null) {
            return null;
        }
        try {
            return target.getClass().getField(fieldName).get(target);
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return null;
        }
    }

    private int intFieldValue(Object target, String fieldName) {
        Object value = fieldValue(target, fieldName);
        if (value instanceof Number number) {
            return number.intValue();
        }
        return -1;
    }

    private Map<String, Object> sourcePayload(Object trackReference) {
        int id = intFieldValue(trackReference, "rekordboxId");
        int player = intFieldValue(trackReference, "player");
        if (id <= 0 || player <= 0) return null;
        Map<String, Object> source = new LinkedHashMap<>();
        source.put("id", id);
        source.put("player", player);
        Object slot = fieldValue(trackReference, "slot");
        source.put("slot", slot == null ? "UNKNOWN" : slot.toString());
        return source;
    }

    private String searchableLabel(Object searchableItem) {
        Object label = fieldValue(searchableItem, "label");
        return label == null ? null : label.toString();
    }

    private Integer durationMillis(int durationSeconds) {
        if (durationSeconds < 0) {
            return null;
        }
        return durationSeconds * 1000;
    }

    private Double normalizedTempo(int rawTempo) {
        if (rawTempo < 0) {
            return null;
        }
        return rawTempo > 1000 ? rawTempo / 100.0d : (double) rawTempo;
    }

    private Integer nullablePositive(int value) {
        return value <= 0 ? null : value;
    }

    static List<Map<String, Object>> structurePhrases(List<?> entries, int endBeat) {
        List<Map<String, Object>> phrases = new java.util.ArrayList<>();
        for (int index = 0; index < entries.size(); index++) {
            Object entry = entries.get(index);
            int beat = intValue(entry, "beat");
            int nextBeat = index + 1 < entries.size() ? intValue(entries.get(index + 1), "beat") : endBeat;
            int beats = nextBeat > beat ? nextBeat - beat : 0;

            Map<String, Object> phrase = new LinkedHashMap<>();
            if (beat <= 0 || nextBeat <= beat) continue;
            phrase.put("startBeat", beat);
            phrase.put("beats", beats);
            phrase.put("kind", enumName(firstValue(firstValue(entry, "kind"), "id")));
            phrases.add(phrase);
        }
        return phrases;
    }

    private Object latestStatusFor(Object update) {
        try {
            Object virtualCdj = singleton("org.deepsymmetry.beatlink.VirtualCdj");
            for (Method method : virtualCdj.getClass().getMethods()) {
                if (method.getName().equals("getLatestStatusFor") && method.getParameterCount() == 1) {
                    Class<?> parameterType = method.getParameterTypes()[0];
                    if (parameterType.isInstance(update)) {
                        return method.invoke(virtualCdj, update);
                    }
                }
            }
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return null;
        }
        return null;
    }

    private Object currentMetadata(int player) {
        try {
            Object finder = singleton("org.deepsymmetry.beatlink.data.MetadataFinder");
            return finder.getClass().getMethod("getLatestMetadataFor", int.class).invoke(finder, player);
        } catch (ReflectiveOperationException ex) {
            return null;
        }
    }

    private void ensureTrack(int player, Object metadata, Map<String, Object> source) {
        if (!source.equals(sourcesByPlayer.get(player))) publishTrack(player, metadata);
    }

    private Map<String, Object> analysisSource(int player, Object tag) {
        if (tag == null) return null;
        try {
            Object finder = singleton("org.deepsymmetry.beatlink.data.AnalysisTagFinder");
            Object loaded = finder.getClass().getMethod("getLoadedAnalysisTags").invoke(finder);
            if (loaded instanceof Map<?, ?> decks) {
                for (Map.Entry<?, ?> deck : decks.entrySet()) {
                    if (intFieldValue(deck.getKey(), "player") != player ||
                            intFieldValue(deck.getKey(), "hotCue") != 0) continue;
                    if (deck.getValue() instanceof Map<?, ?> tags) {
                        for (Object entry : tags.values()) {
                            if (fieldValue(entry, "taggedSection") == tag)
                                return sourcePayload(fieldValue(entry, "dataReference"));
                        }
                    }
                }
            }
        } catch (ReflectiveOperationException ignored) {
            // An unidentifiable analysis must not be assigned to the current track.
        }
        return null;
    }

    private static String enumName(Object value) {
        if (value == null) {
            return "unknown";
        }
        return value.toString().toLowerCase().replace('_', '-');
    }

    private static Object firstValue(Object target, String... methodNames) {
        for (String methodName : methodNames) {
            try {
                return target.getClass().getMethod(methodName).invoke(target);
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                // Try the next likely beat-link accessor name.
            }
        }
        return null;
    }

    private String describe(Throwable throwable) {
        String message = throwable.getMessage();
        if (message == null || message.isBlank()) {
            return throwable.getClass().getName();
        }
        return throwable.getClass().getName() + ": " + message;
    }

    private Object handleObjectMethod(Object proxy, Method method, Object[] args) {
        return switch (method.getName()) {
            case "hashCode" -> System.identityHashCode(proxy);
            case "equals" -> proxy == args[0];
            case "toString" -> "ProDJ Beats beat-link listener proxy";
            default -> defaultValue(method.getReturnType());
        };
    }

    private Object defaultValue(Class<?> returnType) {
        if (!returnType.isPrimitive() || returnType.equals(Void.TYPE)) {
            return null;
        }
        if (returnType.equals(Boolean.TYPE)) {
            return false;
        }
        if (returnType.equals(Character.TYPE)) {
            return '\0';
        }
        if (returnType.equals(Byte.TYPE)) {
            return (byte) 0;
        }
        if (returnType.equals(Short.TYPE)) {
            return (short) 0;
        }
        if (returnType.equals(Integer.TYPE)) {
            return 0;
        }
        if (returnType.equals(Long.TYPE)) {
            return 0L;
        }
        if (returnType.equals(Float.TYPE)) {
            return 0.0f;
        }
        if (returnType.equals(Double.TYPE)) {
            return 0.0d;
        }
        return null;
    }

    @FunctionalInterface
    private interface ReflectedEventHandler {
        void handle(Method method, Object event);
    }
}
