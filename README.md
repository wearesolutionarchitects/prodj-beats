# ProDJ Beats

ProDJ Beats is a cross-platform Astro and TypeScript web app for visualizing
live Pioneer ProDJ Link state. The application consumes normalized event
payloads, validates them with Zod and reduces them into a session state that
the UI can render.

The current project is a greenfield Astro baseline. Python, Flask and native
runtime binaries from the earlier prototype are intentionally not part of this
codebase.

## Local Development

Run `npm run dev` in your VS Code terminal. This builds the Java bridge,
starts **Astro and the bridge together in the foreground**, and shows both
logs in the same terminal. `Ctrl+C` stops both services; if one fails, the
other is stopped too. `npm start` uses the same flow.

Prerequisites: Node.js, JDK 21 or newer, and the beat-link runtime dependencies
installed once with `npm run bridge:deps`.

Open `http://localhost:4325` locally or `http://macstudio.local:4325/` on the
MacBook Air in the same network. Add `?source=replay` for fixture playback.
The port stays fixed at 4325; an occupied port causes a startup failure.
The browser connects to `/events` on the UI host; Astro proxies WebSocket
traffic to the local bridge at `127.0.0.1:8787`. Production hosting needs an
equivalent WebSocket proxy.

Stop any old independently started bridge in its original terminal before
using the combined command. For an old Astro background instance, run
`npx astro dev stop` once. No services are forcibly replaced by `npm run dev`.

Coding agents reuse your running services rather than start separate servers.
Project rules are in [.github/copilot-instructions.md](.github/copilot-instructions.md),
also referenced by [AGENTS.md](AGENTS.md).

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

Run the web app and bridge together:

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

Run only the Java bridge for standalone diagnostics (not alongside `npm run dev`):

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
