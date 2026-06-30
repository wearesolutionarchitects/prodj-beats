# ProDJ Beats Bridge

Java sidecar for live ProDJ Link data.

The bridge starts a local WebSocket endpoint and publishes the same canonical
event envelope consumed by the Astro/TypeScript app:

```json
{
  "type": "beat",
  "version": 1,
  "ms": 1725728634353,
  "payload": {
    "beat": 3,
    "master": true,
    "player": 1,
    "tempo": 129.92
  }
}
```

## Commands

```bash
npm run bridge:build
npm run bridge:deps
npm run bridge:run
```

The default WebSocket endpoint is:

```text
ws://127.0.0.1:8787/events
```

Use `--host` and `--port` to override the bind address:

```bash
npm run bridge:run -- --host 127.0.0.1 --port 8788
```

Every canonical event published by the bridge is printed to stdout and appended
to:

```text
apps/bridge/logs/events.jsonl
```

Use `--event-log` to write to a different JSONL file:

```bash
npm run bridge:run -- --event-log /tmp/prodj-beats-events.jsonl
```

## beat-link runtime jars

This repo does not vendor Java dependencies. Fetch `beat-link` and its runtime
dependencies with:

```bash
npm run bridge:deps
```

The script downloads jars into:

```text
apps/bridge/lib/
```

The run script adds every `apps/bridge/lib/*.jar` to the runtime classpath.
Without those jars, the bridge still starts and emits a `sys` event explaining
that `beat-link` is not available.
