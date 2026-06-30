package com.prodjbeats.bridge;

public final class BridgeMain {
    private BridgeMain() {
    }

    public static void main(String[] args) throws Exception {
        BridgeConfig config = BridgeConfig.fromArgs(args);
        EventBroadcaster broadcaster = new EventBroadcaster();
        BridgeWebSocketServer webSocketServer = new BridgeWebSocketServer(config.host(), config.port(), broadcaster);

        Runtime.getRuntime().addShutdownHook(new Thread(webSocketServer::stop, "bridge-shutdown"));

        webSocketServer.start();
        new BeatLinkAdapter(broadcaster).start();

        System.out.printf("ProDJ Beats bridge listening on ws://%s:%d/events%n", config.host(), config.port());
        Thread.currentThread().join();
    }
}
