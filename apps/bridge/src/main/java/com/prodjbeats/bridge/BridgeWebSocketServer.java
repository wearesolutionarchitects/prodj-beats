package com.prodjbeats.bridge;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class BridgeWebSocketServer {
    private static final String WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    private final String host;
    private final int port;
    private final EventBroadcaster broadcaster;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private volatile ServerSocket serverSocket;
    private volatile boolean running;

    BridgeWebSocketServer(String host, int port, EventBroadcaster broadcaster) {
        this.host = host;
        this.port = port;
        this.broadcaster = broadcaster;
    }

    void start() throws IOException {
        serverSocket = new ServerSocket();
        serverSocket.bind(new InetSocketAddress(host, port));
        running = true;
        executor.submit(this::acceptLoop);
    }

    void stop() {
        running = false;
        try {
            if (serverSocket != null) {
                serverSocket.close();
            }
        } catch (IOException ignored) {
        }
        executor.shutdownNow();
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket socket = serverSocket.accept();
                executor.submit(() -> handle(socket));
            } catch (IOException ex) {
                if (running) {
                    broadcaster.publish(CanonicalEvent.error("WebSocket accept failed: " + ex.getMessage()));
                }
            }
        }
    }

    private void handle(Socket socket) {
        try (socket) {
            HandshakeRequest request = readHandshake(socket.getInputStream());
            if (!"/events".equals(request.path())) {
                writeHttpResponse(socket.getOutputStream(), "404 Not Found", "Not found");
                return;
            }
            if (request.webSocketKey() == null) {
                writeHttpResponse(socket.getOutputStream(), "400 Bad Request", "Missing Sec-WebSocket-Key");
                return;
            }

            writeHandshake(socket.getOutputStream(), request.webSocketKey());
            WebSocketClient client = new WebSocketClient(socket);
            broadcaster.add(client);
            client.send(CanonicalEvent.sys(200, "connected to ProDJ Beats bridge").toJson());
            client.readUntilClosed();
        } catch (IOException ex) {
            broadcaster.publish(CanonicalEvent.error("WebSocket client failed: " + ex.getMessage()));
        }
    }

    private HandshakeRequest readHandshake(InputStream inputStream) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.US_ASCII));
        String requestLine = reader.readLine();
        String path = "/";
        String webSocketKey = null;

        if (requestLine != null) {
            String[] parts = requestLine.split(" ");
            if (parts.length >= 2) {
                path = parts[1];
            }
        }

        String line;
        while ((line = reader.readLine()) != null && !line.isEmpty()) {
            int separator = line.indexOf(':');
            if (separator < 0) {
                continue;
            }
            String header = line.substring(0, separator).trim().toLowerCase(Locale.ROOT);
            String value = line.substring(separator + 1).trim();
            if ("sec-websocket-key".equals(header)) {
                webSocketKey = value;
            }
        }

        return new HandshakeRequest(path, webSocketKey);
    }

    private void writeHandshake(OutputStream outputStream, String webSocketKey) throws IOException {
        String accept = websocketAccept(webSocketKey);
        String response = ""
                + "HTTP/1.1 101 Switching Protocols\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\n"
                + "\r\n";
        outputStream.write(response.getBytes(StandardCharsets.US_ASCII));
        outputStream.flush();
    }

    private void writeHttpResponse(OutputStream outputStream, String status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String headers = ""
                + "HTTP/1.1 " + status + "\r\n"
                + "Content-Type: text/plain; charset=utf-8\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                + "\r\n";
        outputStream.write(headers.getBytes(StandardCharsets.US_ASCII));
        outputStream.write(bytes);
        outputStream.flush();
    }

    private String websocketAccept(String webSocketKey) {
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            byte[] digest = sha1.digest((webSocketKey + WEBSOCKET_GUID).getBytes(StandardCharsets.US_ASCII));
            return Base64.getEncoder().encodeToString(digest);
        } catch (Exception ex) {
            throw new IllegalStateException("Unable to calculate WebSocket accept key", ex);
        }
    }

    private record HandshakeRequest(String path, String webSocketKey) {
    }

    private final class WebSocketClient implements EventSink {
        private final Socket socket;
        private final OutputStream outputStream;

        WebSocketClient(Socket socket) throws IOException {
            this.socket = socket;
            this.outputStream = socket.getOutputStream();
        }

        @Override
        public void send(String message) throws IOException {
            synchronized (outputStream) {
                writeTextFrame(outputStream, message);
            }
        }

        @Override
        public void close() {
            broadcaster.remove(this);
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        }

        void readUntilClosed() throws IOException {
            InputStream inputStream = socket.getInputStream();
            while (!socket.isClosed()) {
                int firstByte = inputStream.read();
                if (firstByte < 0) {
                    break;
                }
                int secondByte = inputStream.read();
                if (secondByte < 0) {
                    break;
                }
                int opcode = firstByte & 0x0F;
                long payloadLength = secondByte & 0x7F;

                if (payloadLength == 126) {
                    payloadLength = (inputStream.read() << 8) | inputStream.read();
                } else if (payloadLength == 127) {
                    payloadLength = 0;
                    for (int index = 0; index < 8; index++) {
                        payloadLength = (payloadLength << 8) | inputStream.read();
                    }
                }

                byte[] mask = new byte[4];
                boolean masked = (secondByte & 0x80) != 0;
                if (masked) {
                    readFully(inputStream, mask);
                }

                byte[] payload = new byte[(int) payloadLength];
                readFully(inputStream, payload);

                if (opcode == 0x8) {
                    writeCloseFrame(outputStream);
                    break;
                }
            }
            close();
        }

        private void readFully(InputStream inputStream, byte[] bytes) throws IOException {
            int offset = 0;
            while (offset < bytes.length) {
                int read = inputStream.read(bytes, offset, bytes.length - offset);
                if (read < 0) {
                    throw new IOException("Unexpected end of WebSocket frame");
                }
                offset += read;
            }
        }

        private void writeTextFrame(OutputStream outputStream, String message) throws IOException {
            byte[] payload = message.getBytes(StandardCharsets.UTF_8);
            ByteArrayOutputStream frame = new ByteArrayOutputStream();
            frame.write(0x81);
            if (payload.length <= 125) {
                frame.write(payload.length);
            } else if (payload.length <= 65535) {
                frame.write(126);
                frame.write((payload.length >>> 8) & 0xFF);
                frame.write(payload.length & 0xFF);
            } else {
                frame.write(127);
                for (int shift = 56; shift >= 0; shift -= 8) {
                    frame.write((payload.length >>> shift) & 0xFF);
                }
            }
            frame.write(payload);
            outputStream.write(frame.toByteArray());
            outputStream.flush();
        }

        private void writeCloseFrame(OutputStream outputStream) throws IOException {
            outputStream.write(new byte[] { (byte) 0x88, 0x00 });
            outputStream.flush();
        }
    }
}
