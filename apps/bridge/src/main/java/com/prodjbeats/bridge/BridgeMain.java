package com.prodjbeats.bridge;

public final class BridgeMain {
    private BridgeMain() {
    }

    public static void main(String[] args) throws Exception {
        BridgeConfig config = BridgeConfig.fromArgs(args);
        EventBroadcaster broadcaster = new EventBroadcaster(config.eventLogPath());
        BridgeWebSocketServer webSocketServer = new BridgeWebSocketServer(config.host(), config.port(), broadcaster);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            webSocketServer.stop();
            broadcaster.close();
        }, "bridge-shutdown"));

        webSocketServer.start();
        new BeatLinkAdapter(broadcaster).start();

        System.out.printf("ProDJ Beats bridge listening on ws://%s:%d/events%n", config.host(), config.port());
        System.out.printf("ProDJ Beats event log writing to %s%n", config.eventLogPath());
        Thread.currentThread().join();
    }
}
