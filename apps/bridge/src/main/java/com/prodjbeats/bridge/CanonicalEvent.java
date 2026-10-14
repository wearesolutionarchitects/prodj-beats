package com.prodjbeats.bridge;

import java.util.Map;

record CanonicalEvent(String type, int version, long ms, Map<String, Object> payload) {
    static CanonicalEvent sys(int code, String message) {
        return new CanonicalEvent("sys", 2, System.currentTimeMillis(), Map.of("code", code, "msg", message));
    }

    static CanonicalEvent error(String message) {
        return new CanonicalEvent("error", 2, System.currentTimeMillis(), Map.of("message", message));
    }

    String toJson() {
        return Json.write(Map.of(
                "type", type,
                "version", version,
                "ms", ms,
                "payload", payload
        ));
    }
}
