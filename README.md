# ProDJ Beats

ProDJ Beats is a cross-platform Astro and TypeScript web app for visualizing
live Pioneer ProDJ Link state. The application consumes normalized event
payloads, validates them with Zod and reduces them into a session state that
the UI can render.

The current project is a greenfield Astro baseline. Python, Flask and native
runtime binaries from the earlier prototype are intentionally not part of this
codebase.

## Local Development

Run `npm run dev` and open `http://localhost:4325`. The dev server uses a fixed
port and fails if it is occupied instead of moving to another project’s port.
The server listens on the local network. On another device in the same network,
open `http://macstudio.local:4325/?source=replay` (or use the Mac Studio's LAN IP).

Astro can keep a dev server running in the background. If `npm run dev` reports
an existing server, use its URL or restart it with:

```bash
npm run dev -- stop
npm run dev
```

For live hardware data, also run `npm run bridge:run` on the Mac Studio. The
browser connects to `/events` on the UI host; the dev server proxies WebSocket
traffic to `ws://127.0.0.1:8787/events`. The bridge can stay bound to loopback.
A separately hosted production UI needs an equivalent WebSocket proxy.

## Current Scope

- Astro SPA with Preact integration.
- Typed ProDJ Link event contracts.
- Session reducer for devices, tracks, beats, structure, artwork and messages.
- Fixture replay for deterministic local development.
- Java bridge sidecar skeleton for Deep-Symmetry `beat-link`.
- GitHub Actions CI for app and bridge verification.

## Architecture

```text
apps/
  bridge/          Java sidecar. Publishes normalized events over WebSocket.

src/
  application/     Session use cases and state reducers.
  components/      Astro UI components.
  content/         Prepared documentation content for future Starlight setup.
  domain/          Pure models, schemas and parser classes.
  infrastructure/  Fixture and future transport adapters.
  layouts/         Shared document shell.
  pages/           SPA entry points.
  scripts/         npm-driven project scripts.

scripts/           Root-level npm helper scripts.
```

Java stays behind the bridge boundary. Astro and TypeScript remain the
application and UI layer. The bridge currently exposes:

```text
ws://127.0.0.1:8787/events
```

## Commands

Install dependencies:

```bash
npm install
```

Run the web app:

```bash
npm run dev
```

Run verification:

```bash
npm run test
npm run check
npm run fixture:replay
npm run build
npm run bridge:deps
npm run bridge:build
```

Run the Java bridge:

```bash
npm run bridge:run
```

`npm run bridge:deps` downloads the `beat-link` runtime jars and their
dependencies into `apps/bridge/lib/`. `npm run bridge:run` starts the local
WebSocket server. JAR files are intentionally ignored and not committed.

## Development Principles

- Keep the event contract canonical and shared by fixtures, tests and UI.
- Prefer fixture replay before live transport for testable UI work.
- Keep domain code independent from Astro, browser APIs and the Java bridge.
- Use npm scripts as the primary developer entry points.
- Keep the repository cross-platform: no committed `.exe`, `.dll` or `.jar`
  runtime artifacts.

## Documentation

Developer documentation is being prepared under:

```text
src/content/docs/
```

This keeps the project ready for a later Starlight and Astro content collections
setup without making documentation tooling part of the runtime yet.
