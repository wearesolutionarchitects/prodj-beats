# ProDJ Beats

Greenfield refactor of the former `vizlink-to-python` prototype, aligned with
the Astro conventions used in `/Users/heikofanieng/GitHub/01-Heiko/heiko`.

The new baseline is a cross-platform Astro and TypeScript SPA. The old Python
and executable based flow is intentionally not part of the target runtime. Its
useful lessons were kept as domain knowledge: ProDJ Link events arrive as typed
payloads and are reduced into a session state that the UI can render.

## Architecture

```text
src/
  domain/          Pure models, schemas and parser classes.
  application/     Use cases and state reducers.
  infrastructure/  Fixture and future transport adapters.
  components/      Astro UI components.
  layouts/         Shared document shell, following the Heiko project layout.
  pages/           SPA entry points.
  scripts/         npm-driven project scripts.
apps/
  bridge/          Java beat-link sidecar with a local WebSocket endpoint.
```

The backend integration is a small Java sidecar based on Deep-Symmetry
`beat-link`. It exposes normalized JSON events over a local WebSocket endpoint.
Java stays behind an adapter boundary; Astro and TypeScript remain the
application and UI layer.

## Commands

```bash
npm install
npm run dev
npm run test
npm run build
npm run bridge:build
npm run bridge:run
```

`npm run bridge:run` starts a WebSocket server on `ws://127.0.0.1:8787/events`.
Place the `beat-link` runtime jars and their dependencies in `apps/bridge/lib/`
before connecting real ProDJ Link hardware.

## Principles

- DRY: one event contract, reused by fixtures, tests and UI.
- KISS: fixture replay first, live transport later.
- Clean Architecture: domain does not depend on Astro or browser APIs.
- OOP where it helps: parser, deck aggregate and session reducer are classes.
- Cross-platform: no `.exe` runtime artifacts.
