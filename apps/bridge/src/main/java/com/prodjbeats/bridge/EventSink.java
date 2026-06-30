package com.prodjbeats.bridge;

import java.io.IOException;

interface EventSink {
    void send(String message) throws IOException;

    void close();
}
