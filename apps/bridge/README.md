# ProDJ Beats Bridge

Java sidecar for live ProDJ Link data.

The bridge starts a local WebSocket endpoint and publishes the same canonical
event envelope consumed by the Astro/TypeScript app:

```json
{
  "type": "beat",
  "version": 2,
  "ms": 1725728634353,
  "payload": {
    "beatWithinBar": 3,
    "trackBeat": 263,
    "master": true,
    "player": 1,
    "tempo": 129.92
  }
}
```

## Commands

Normal development: `npm run dev` starts web app and bridge together with
visible terminal logs. `Ctrl+C` stops both. The standalone commands below
are for bridge diagnostics; do not run a second bridge alongside the app.

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

## Event version and reconnects

The bridge emits version 2. Beat events distinguish `beatWithinBar` (1–4)
from `trackBeat` (absolute track position); unavailable positions are `null`.
Track, structure and artwork events carry `source: { id, player, slot }`.
A track with `source: null` clears the deck; artwork with `jpg: null` clears
its image. Phrases use `startBeat` and `beats`; phrase progress is derived
centrally by the TypeScript domain.

New connections receive the retained current deck state before subsequent
live events. Track changes/device loss discard dependent retained data.
Version 1 recordings need explicit migration because their beat field was
ambiguous. See the developer notes for the full contract.

`npm run bridge:test` builds and runs hardware-independent bridge regression
checks without downloading runtime JARs.

## Starting with hardware connected later

Discovery and beat reception start first. Status/metadata services start on a
background worker once players appear and retry after a failed start. A false
`VirtualCdj.start()` result is not reported as successful. Retry attempts reuse
listeners rather than registering duplicate callbacks. The metadata listener
is attached before CrateDigger can start MetadataFinder.

`npm run dev` and `npm run bridge:run` share the Java build/classpath setup
and rebuild Java sources on every launch. Vite hot reload
updates the web UI only; Java changes require restarting the bridge. Initial
metadata/artwork may arrive after beat packets while the player's database is
being fetched. Two network adapters on the same subnet can cause duplicate
packets; beat-link reports this in its console diagnostics.

Device announcements also include `address`, the discovered device IP address
(or `null` if unavailable). The live header groups active announcements by IP,
so an XDJ-XZ's logical player announcements appear as one connected device.
