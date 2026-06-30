package com.prodjbeats.bridge;

import java.nio.file.Path;

record BridgeConfig(String host, int port, Path eventLogPath) {
    static BridgeConfig fromArgs(String[] args) {
        String host = "127.0.0.1";
        int port = 8787;
        Path eventLogPath = Path.of("apps", "bridge", "logs", "events.jsonl");

        for (int index = 0; index < args.length; index++) {
            switch (args[index]) {
                case "--host" -> host = valueAfter(args, ++index, "--host");
                case "--port" -> port = Integer.parseInt(valueAfter(args, ++index, "--port"));
                case "--event-log" -> eventLogPath = Path.of(valueAfter(args, ++index, "--event-log"));
                default -> throw new IllegalArgumentException("Unknown bridge option: " + args[index]);
            }
        }

        return new BridgeConfig(host, port, eventLogPath);
    }

    private static String valueAfter(String[] args, int index, String option) {
        if (index >= args.length) {
            throw new IllegalArgumentException(option + " requires a value");
        }
        return args[index];
    }
}
