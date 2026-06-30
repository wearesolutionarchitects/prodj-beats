---
title: Developer Notes
description: Architecture notes for the ProDJ Beats Astro app and Java bridge.
---

# Developer Notes

ProDJ Beats is split into a TypeScript application core and a Java bridge. The
core app owns event contracts, validation, state reduction and UI rendering. The
bridge owns ProDJ Link network integration and forwards normalized JSON events
over a local WebSocket endpoint.

## Event Flow

```mermaid
flowchart LR
  Hardware["ProDJ Link hardware"] --> Bridge["apps/bridge Java sidecar"]
  Bridge --> WebSocket["ws://127.0.0.1:8787/events"]
  Fixtures["Fixture replay"] --> Parser["EventParser + Zod schemas"]
  WebSocket --> Parser
  Parser --> Session["ProDjLinkSession"]
  Session --> Decks["DeckState snapshots"]
  Decks --> UI["Astro / Preact UI"]
```

## Core Classes

```mermaid
classDiagram
  class EventParser {
    +parse(input) ProDjLinkEvent
    +parseMany(input[]) ProDjLinkEvent[]
  }

  class ProDjLinkSession {
    -decks Map
    -parser EventParser
    -lastEvent ProDjLinkEvent
    -messages string[]
    +applyRaw(input) SessionSnapshot
    +apply(event) SessionSnapshot
    +snapshot() SessionSnapshot
  }

  class Deck {
    -state DeckState
    +snapshot() DeckState
    +updateDevice(event) void
    +updateBeat(event) void
    +updateTrack(event) void
    +updateStructure(event) void
    +updateArtwork(jpg) void
  }

  class BridgeMain {
    +main(args) void
  }

  class BeatLinkAdapter {
    +start() void
  }

  class BridgeWebSocketServer {
    +start() void
    +stop() void
  }

  EventParser --> ProDjLinkSession
  ProDjLinkSession "1" --> "1..*" Deck
  BridgeMain --> BeatLinkAdapter
  BridgeMain --> BridgeWebSocketServer
  BeatLinkAdapter --> BridgeWebSocketServer : publishes canonical events
```

## Canonical Event Envelope

All transport sources should emit the same shape:

```json
{
  "type": "beat",
  "version": 1,
  "ms": 1725728634353,
  "payload": {
    "beat": 263,
    "master": true,
    "onAir": true,
    "player": 1,
    "tempo": 129.92
  }
}
```

The TypeScript schemas live in `src/domain/events.ts`. New live transport work
should adapt into that contract instead of adding UI-specific event shapes.

## Boundaries

- `src/domain`: pure TypeScript models, schemas and parser classes.
- `src/application`: session-level use cases and reducers.
- `src/infrastructure`: fixtures and future browser transport adapters.
- `apps/bridge`: Java sidecar for `beat-link` integration.
- `src/content/docs`: prepared documentation content for future Starlight pages.

## Bridge Notes

The Java bridge is intentionally buildable without vendored JARs. Runtime
dependencies belong in `apps/bridge/lib/` and are ignored by Git. This keeps the
repository cross-platform and avoids committing binary runtime artifacts.

The bridge can be checked without hardware:

```bash
npm run bridge:build
npm run bridge:run
```

Without `beat-link` JARs, the bridge starts and publishes a `sys` event that
explains the missing runtime dependencies.
