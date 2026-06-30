package com.prodjbeats.bridge;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.Map;

final class BeatLinkAdapter {
    private final EventBroadcaster broadcaster;

    BeatLinkAdapter(EventBroadcaster broadcaster) {
        this.broadcaster = broadcaster;
    }

    void start() {
        try {
            startVirtualCdj();
            startDeviceFinder();
            startBeatFinder();
            broadcaster.publish(CanonicalEvent.sys(200, "beat-link bridge started"));
        } catch (ClassNotFoundException missingBeatLink) {
            broadcaster.publish(CanonicalEvent.sys(
                    503,
                    "beat-link jars not found; add them to apps/bridge/lib before using hardware"
            ));
        } catch (ReflectiveOperationException ex) {
            broadcaster.publish(CanonicalEvent.error("Unable to start beat-link: " + ex.getMessage()));
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

    private void registerListener(
            Object target,
            String methodName,
            String listenerClassName,
            ReflectedEventHandler handler
    ) throws ReflectiveOperationException {
        Class<?> listenerClass = Class.forName(listenerClassName);
        InvocationHandler invocationHandler = (proxy, method, args) -> {
            if (args != null && args.length == 1 && method.getReturnType().equals(Void.TYPE)) {
                handler.handle(method, args[0]);
            }
            return null;
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
        double tempo = doubleValue(beat, "getEffectiveTempo", "getBpm");
        Boolean master = booleanValue(beat, "isTempoMaster");

        broadcaster.publish(new CanonicalEvent(
                "beat",
                1,
                System.currentTimeMillis(),
                Map.of(
                        "beat", Math.max(0, beatWithinBar),
                        "master", master,
                        "player", Math.max(0, player),
                        "tempo", tempo
                )
        ));
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

    @FunctionalInterface
    private interface ReflectedEventHandler {
        void handle(Method method, Object event);
    }
}
