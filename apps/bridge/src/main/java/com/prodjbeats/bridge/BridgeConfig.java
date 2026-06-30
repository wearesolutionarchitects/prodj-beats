package com.prodjbeats.bridge;

record BridgeConfig(String host, int port) {
    static BridgeConfig fromArgs(String[] args) {
        String host = "127.0.0.1";
        int port = 8787;

        for (int index = 0; index < args.length; index++) {
            switch (args[index]) {
                case "--host" -> host = valueAfter(args, ++index, "--host");
                case "--port" -> port = Integer.parseInt(valueAfter(args, ++index, "--port"));
                default -> throw new IllegalArgumentException("Unknown bridge option: " + args[index]);
            }
        }

        return new BridgeConfig(host, port);
    }

    private static String valueAfter(String[] args, int index, String option) {
        if (index >= args.length) {
            throw new IllegalArgumentException(option + " requires a value");
        }
        return args[index];
    }
}
