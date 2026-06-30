package com.prodjbeats.bridge;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.ByteBuffer;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

final class BeatLinkAdapter {
    private final EventBroadcaster broadcaster;
    private final Map<Integer, List<Map<String, Object>>> structuresByPlayer = new ConcurrentHashMap<>();

    BeatLinkAdapter(EventBroadcaster broadcaster) {
        this.broadcaster = broadcaster;
    }

    void start() {
        try {
            startVirtualCdj();
            startMetadataServices();
            startDeviceFinder();
            startBeatFinder();
            broadcaster.publish(CanonicalEvent.sys(200, "beat-link bridge started"));
        } catch (ClassNotFoundException missingBeatLink) {
            broadcaster.publish(CanonicalEvent.sys(
                    503,
                    "beat-link jars not found; add them to apps/bridge/lib before using hardware"
            ));
        } catch (InvocationTargetException ex) {
            Throwable cause = ex.getCause() == null ? ex : ex.getCause();
            broadcaster.publish(CanonicalEvent.error("Unable to start beat-link: " + describe(cause)));
        } catch (ReflectiveOperationException ex) {
            broadcaster.publish(CanonicalEvent.error("Unable to start beat-link: " + describe(ex)));
        }
    }

    private void startVirtualCdj() throws ReflectiveOperationException {
        Object virtualCdj = singleton("org.deepsymmetry.beatlink.VirtualCdj");
        invokeIfPresent(virtualCdj, "start");
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
        Object crateDigger = singleton("org.deepsymmetry.beatlink.data.CrateDigger");
        invokeIfPresent(crateDigger, "start");

        Object metadataFinder = singleton("org.deepsymmetry.beatlink.data.MetadataFinder");
        registerListener(
                metadataFinder,
                "addTrackMetadataListener",
                "org.deepsymmetry.beatlink.data.TrackMetadataListener",
                this::handleTrackMetadata
        );
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
    }

    private void registerListener(
            Object target,
            String methodName,
            String listenerClassName,
            ReflectedEventHandler handler
    ) throws ReflectiveOperationException {
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
    }

    private void handleDeviceAnnouncement(Method method, Object announcement) {
        String name = stringValue(announcement, "getDeviceName", "getName");
        int player = intValue(announcement, "getDeviceNumber", "getDevice", "getPlayer");

        if (player < 0) {
            broadcaster.publish(CanonicalEvent.sys(202, "Ignored device event without player number"));
            return;
        }

        broadcaster.publish(new CanonicalEvent(
                "device",
                1,
                System.currentTimeMillis(),
                Map.of(
                        "active", !method.getName().toLowerCase().contains("lost"),
                        "name", name == null ? "Unknown Device" : name,
                        "player", player
                )
        ));
    }

    private void handleBeat(Method method, Object beat) {
        int player = intValue(beat, "getDeviceNumber", "getDevice", "getPlayer");
        int beatWithinBar = intValue(beat, "getBeatWithinBar");
        int beatNumber = beatNumber(beat);
        double tempo = doubleValue(beat, "getEffectiveTempo", "getBpm");
        Boolean master = booleanValue(beat, "isTempoMaster");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("beat", Math.max(0, beatWithinBar));
        payload.put("beatNumber", beatNumber > 0 ? beatNumber : null);
        payload.put("master", master);
        payload.put("phrase", currentPhrase(Math.max(0, player), beatNumber));
        payload.put("player", Math.max(0, player));
        payload.put("tempo", tempo);

        broadcaster.publish(new CanonicalEvent(
                "beat",
                1,
                System.currentTimeMillis(),
                payload
        ));
    }

    private void handleTrackMetadata(Method method, Object update) {
        Object metadata = fieldValue(update, "metadata");
        if (metadata == null) {
            return;
        }

        int player = intFieldValue(update, "player");
        Object trackReference = fieldValue(metadata, "trackReference");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("album", searchableLabel(firstValue(metadata, "getAlbum")));
        payload.put("artist", searchableLabel(firstValue(metadata, "getArtist")));
        payload.put("cues", List.of());
        payload.put("duration", durationMillis(intValue(metadata, "getDuration")));
        payload.put("player", Math.max(0, player));
        payload.put("source", sourcePayload(trackReference));
        payload.put("tempo", normalizedTempo(intValue(metadata, "getTempo")));
        payload.put("title", stringValue(metadata, "getTitle"));
        payload.put("year", nullablePositive(intValue(metadata, "getYear")));

        broadcaster.publish(new CanonicalEvent("track", 1, System.currentTimeMillis(), payload));
    }

    private void handleAlbumArt(Method method, Object update) {
        Object art = fieldValue(update, "art");
        if (art == null) {
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
        payload.put("jpg", Base64.getEncoder().encodeToString(bytes));
        payload.put("player", Math.max(0, intFieldValue(update, "player")));

        broadcaster.publish(new CanonicalEvent("art", 1, System.currentTimeMillis(), payload));
    }

    private void handleStructure(Method method, Object update) {
        Object taggedSection = fieldValue(update, "taggedSection");
        Object songStructureTag = firstValue(taggedSection, "body");
        Object body = firstValue(songStructureTag, "body");
        Object entries = firstValue(body, "entries");

        if (!(entries instanceof List<?> phrases)) {
            return;
        }

        int player = intFieldValue(update, "player");
        int endBeat = intValue(body, "endBeat");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("bank", enumName(firstValue(body, "bank")));
        payload.put("mood", enumName(firstValue(body, "mood")));
        List<Map<String, Object>> structurePhrases = structurePhrases(phrases, endBeat);
        payload.put("phrases", structurePhrases);
        payload.put("player", Math.max(0, player));

        structuresByPlayer.put(Math.max(0, player), structurePhrases);
        broadcaster.publish(new CanonicalEvent("structure", 1, System.currentTimeMillis(), payload));
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
        Map<String, Object> source = new LinkedHashMap<>();
        source.put("id", Math.max(0, intFieldValue(trackReference, "rekordboxId")));
        source.put("player", Math.max(0, intFieldValue(trackReference, "player")));
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
            phrase.put("beat", Math.max(0, beat));
            phrase.put("beats", beats);
            phrase.put("kind", enumName(firstValue(firstValue(entry, "kind"), "id")));
            phrases.add(phrase);
        }
        return phrases;
    }

    private int beatNumber(Object beat) {
        Object status = latestStatusFor(beat);
        int statusBeat = intValue(status, "getBeatNumber");
        if (statusBeat > 0) {
            return statusBeat;
        }
        return intValue(beat, "getBeatNumber");
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

    private Map<String, Object> currentPhrase(int player, int beatNumber) {
        if (beatNumber <= 0) {
            return null;
        }

        List<Map<String, Object>> phrases = structuresByPlayer.get(player);
        if (phrases == null) {
            return null;
        }

        for (Map<String, Object> phrase : phrases) {
            int start = numberValue(phrase.get("beat"));
            int length = numberValue(phrase.get("beats"));
            if (beatNumber >= start && beatNumber < start + length) {
                Map<String, Object> current = new LinkedHashMap<>(phrase);
                current.put("progressBeats", beatNumber - start);
                return current;
            }
        }

        return null;
    }

    private int numberValue(Object value) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        return -1;
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
