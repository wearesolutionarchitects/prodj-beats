package com.prodjbeats.bridge;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.ByteBuffer;
import java.net.InetAddress;
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
    private boolean servicesReady;
    private final Map<Integer, Map<String, Object>> sourcesByPlayer = new HashMap<>();

    BeatLinkAdapter(EventBroadcaster broadcaster) {
        this.broadcaster = broadcaster;
    }

    void start() {
        broadcaster.publish(CanonicalEvent.sys(202, "Waiting for players, status and metadata services"));
        startup.scheduleWithFixedDelay(this::startServices, 0, 5, TimeUnit.SECONDS);
        startup.scheduleWithFixedDelay(this::publishPositions, 0, 250, TimeUnit.MILLISECONDS);
    }

    private void startServices() {
        try {
            startDeviceFinder();
            startBeatFinder();
            Object virtualCdj = singleton("org.deepsymmetry.beatlink.VirtualCdj");
            registerListener(virtualCdj, "addUpdateListener",
                    "org.deepsymmetry.beatlink.DeviceUpdateListener", this::handleMixerStatus);
            if (!Boolean.TRUE.equals(firstValue(virtualCdj, "isRunning"))) {
                servicesReady = false;
                Object devices = firstValue(singleton("org.deepsymmetry.beatlink.DeviceFinder"), "getCurrentDevices");
                if (!(devices instanceof Collection<?> found) || found.isEmpty()) return;
                if (!startService(virtualCdj)) {
                    broadcaster.publish(CanonicalEvent.sys(503, "VirtualCdj could not start; retrying"));
                    return;
                }
            }
            if (!servicesReady) {
                startMetadataServices();
                invokeIfPresent(singleton("org.deepsymmetry.beatlink.data.TimeFinder"), "start");
                servicesReady = true;
                broadcaster.publish(CanonicalEvent.sys(200, "beat-link status and metadata services started"));
            }
        } catch (ReflectiveOperationException | RuntimeException ex) {
            reportStartupError(ex);
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
                Object cdj = singleton("org.deepsymmetry.beatlink.VirtualCdj");
                Object status = cdj.getClass().getMethod("getLatestStatusFor", int.class).invoke(cdj, player);
                payload.put("playbackStatus", playbackStatus(status, entry.getValue()));
                broadcaster.publish(new CanonicalEvent("position", 2, System.currentTimeMillis(), payload));
            }
        } catch (ReflectiveOperationException | RuntimeException ex) {
            broadcaster.publish(CanonicalEvent.error("Unable to read track position: " + describe(ex)));
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
        invokeIfPresent(finder, "start");
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

        if (method.getName().toLowerCase().contains("lost")) sourcesByPlayer.remove(player);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("active", !method.getName().toLowerCase().contains("lost"));
        payload.put("name", name == null ? "Unknown Device" : name);
        payload.put("player", player);
        Object address = firstValue(announcement, "getAddress");
        payload.put("address", address instanceof InetAddress ip ? ip.getHostAddress() : null);
        broadcaster.publish(new CanonicalEvent("device", 2, System.currentTimeMillis(), payload));
    }

    private synchronized void handleMixerStatus(Method method, Object status) {
        if (!status.getClass().getSimpleName().equals("MixerStatus")) return;
        publishMixerStatus(status);
    }

    // Separate mapping also permits regression checks without runtime beat-link JARs.
    void publishMixerStatus(Object status) {
        int player = intValue(status, "getDeviceNumber");
        if (player <= 0) return;
        int bpm = intValue(status, "getBpm");
        double tempo = doubleValue(status, "getEffectiveTempo");
        int pitch = intValue(status, "getPitch");
        int beat = intValue(status, "getBeatWithinBar");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("player", player);
        payload.put("bpm", bpm > 0 && bpm != 65535 ? bpm / 100.0 : null);
        payload.put("tempo", bpm > 0 && bpm != 65535 && Double.isFinite(tempo) && tempo > 0 ? tempo : null);
        payload.put("pitchPercent", pitch >= 0 ? (pitch / 1048576.0 - 1) * 100 : null);
        payload.put("master", booleanValue(status, "isTempoMaster"));
        payload.put("synced", booleanValue(status, "isSynced"));
        payload.put("beatWithinBar", beat >= 1 && beat <= 4 ? beat : null);
        payload.put("beatMeaningful", booleanValue(status, "isBeatWithinBarMeaningful"));
        payload.put("masterHandoff", firstValue(status, "getDeviceMasterIsBeingYieldedTo"));
        broadcaster.publish(new CanonicalEvent("mixer", 2, System.currentTimeMillis(), payload));
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
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("player", player);
            payload.put("source", null);
            broadcaster.publish(new CanonicalEvent("track", 2, System.currentTimeMillis(), payload));
            return;
        }
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

    private int intValue(Object target, String... methodNames) {
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

    private List<Map<String, Object>> structurePhrases(List<?> entries, int endBeat) {
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

    private String enumName(Object value) {
        if (value == null) {
            return "unknown";
        }
        return value.toString().toLowerCase().replace('_', '-');
    }

    private Object firstValue(Object target, String... methodNames) {
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
