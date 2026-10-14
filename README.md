# ProDJ Beats

**[Deutsch](#deutsch) · [English](#english)**

## Deutsch

ProDJ Beats ergänzt vorhandene DJ-Hardware um eine größere Live-Anzeige im
Browser – beispielsweise auf einem Tablet neben dem eingebauten Display.
Das Projekt nutzt die Open-Source-Bibliothek
[beat-link von Deep Symmetry](https://github.com/Deep-Symmetry/beat-link), um
Daten aus dem ProDJ-Link-Netzwerk für eine gemeinsame Weboberfläche aufzubereiten.

Die Idee: Bewährte, funktionierende Geräte mit ergänzender Software länger und
vielseitiger nutzen. ProDJ Beats ist ein unabhängiges Entwicklungsprojekt;
es besteht keine Verbindung zu AlphaTheta oder Pioneer DJ.

### Aktueller Stand

Der Prototyp wurde mit einem **XDJ-XZ** live geprüft. Die Oberfläche zeigt,
soweit vom Gerät und vom geladenen Track verfügbar:

- Tracktitel, Interpret, Album und Cover.
- Wiedergabestatus, Laufzeit und Restzeit; rote Restzeitanzeige ab 20 Sekunden.
- BPM, Beat im Takt, absolute Track-Beatposition und musikalische Phrasen.
- Tempo-Master mit effektivem Tempo, Grund-BPM, Pitch und Sync-Status.
- Beat-Anzeige 1–4, gemeldete Masterübergaben und On-Air-Kanäle.
- Verbundene Geräte und deren vom Netzwerk gemeldete Adressen.

Live-Daten und Fixture-Replay verwenden denselben Eventvertrag und dieselbe
Zustandsverarbeitung. Replay ermöglicht Entwicklung und Tests ohne DJ-Hardware.
Unbekannte Werte bleiben als solche erkennbar.

**Grenzen:** Andere Gerätemodelle sind durch die XDJ-XZ-Tests nicht automatisch
validiert. Master-Level-Regler, Audiopegel und Beat-FX-Einstellungen werden am
XDJ-XZ derzeit nicht ausgelesen. On-Air bezeichnet den gemeldeten Kanalzustand,
keine Audiopegelmessung. Die weitere Nutzung der **RB-DMX1** ist ein
Untersuchungsthema; eine Integration ist noch nicht umgesetzt.

### Einrichtung und Start

Voraussetzungen: **Node.js ab 22.12**, **npm ab 9.6.5** und **JDK 21 oder neuer**.
Für Live-Daten muss der Rechner das ProDJ-Link-Netzwerk der DJ-Hardware erreichen.
Ein Tablet benötigt Zugriff auf den Rechner, der die Anwendung ausführt.

```bash
npm ci
npm run bridge:deps
npm run dev
```

`npm run bridge:deps` lädt die Java-Abhängigkeiten herunter. `npm run dev` baut
die Bridge und startet **Web-App und Java-Bridge gemeinsam im Vordergrund**.
Beide Logs erscheinen im selben Terminal; `Ctrl+C` beendet beide Prozesse.
`npm start` ist gleichwertig. Keinen zusätzlichen Bridge-Prozess daneben starten.

Die Web-App läuft auf Port **4325**. Öffne die vom Terminal angezeigte Adresse.
Für ein Tablet verwende `http://<Adresse-des-Rechners>:4325/` und ersetze den
Platzhalter durch die erreichbare LAN-Adresse. Ergänze `?source=replay` für die
Demo mit Fixtures. Bei Verwendung eines eigenen Hostnamens prüfe die
`allowedHosts`-Einstellung in `astro.config.mjs`.

Die Bridge bleibt auf den lokalen Rechner beschränkt und nutzt Port **8787**.
Der Browser verbindet sich über `/events`; der Dev-Server leitet diese
WebSocket-Verbindung an die Bridge weiter. Ein statischer Web-Build allein
liefert keine Live-Daten; ein Deployment benötigt zusätzlich die laufende Bridge
und einen entsprechenden WebSocket-Proxy.

Java-Änderungen benötigen einen Neustart von `npm run dev`. Änderungen an der
Weboberfläche werden während der Entwicklung über HMR aktualisiert. Mehrere
Netzwerkadapter im selben Subnetz können die Adapterwahl und den Empfang
beeinflussen; die Bridge protokolliert ihre gewählte Adresse und Playernummer.

### Entwicklung und Prüfung

```bash
npm test
npm run check
npm run bridge:test
npm run fixture:replay
npm run build
```

Die Tests prüfen Eventvalidierung, Zustandswechsel, Live-/Replay-Verarbeitung
und die Java-Bridge. Erfolgreiche Fixtures ersetzen keine Hardwareprüfung.
Projektregeln stehen in [AGENTS.md](AGENTS.md) und
[.github/copilot-instructions.md](.github/copilot-instructions.md).

## English

ProDJ Beats adds a larger browser-based live display to existing DJ hardware –
for example, a tablet alongside the built-in screen. It uses the open-source
[beat-link library by Deep Symmetry](https://github.com/Deep-Symmetry/beat-link)
to bring ProDJ Link network data into a shared web interface.

The aim is to extend the useful life and capabilities of working DJ equipment
through complementary software. ProDJ Beats is an independent development
project, with no affiliation to AlphaTheta or Pioneer DJ.

### Current status

The prototype has been tested live with an **XDJ-XZ**. Where supported by the
device and loaded track, the interface shows:

- Track title, artist, album and artwork.
- Playback status, elapsed and remaining time; red remaining time at 20 seconds or less.
- BPM, beat within the bar, absolute track beat and musical phrases.
- Tempo master with effective tempo, base BPM, pitch and sync status.
- A 1–4 beat indicator, reported master handoffs and on-air channels.
- Connected devices and their network-reported addresses.

Live data and fixture replay share the same event contract and state handling.
Replay supports development and testing without DJ hardware. Unknown values
remain visibly unknown.

**Limitations:** XDJ-XZ testing does not validate other hardware models.
Master-level knob position, audio meters and Beat FX settings are currently
unavailable on the XDJ-XZ. On-air represents reported channel state, not a
measurement of audio level. Further use of the **RB-DMX1** is under
investigation; integration has not been implemented.

### Setup and start

Requirements: **Node.js 22.12 or newer**, **npm 9.6.5 or newer**, and **JDK 21 or
newer**. For live data, the computer must reach the hardware's ProDJ Link
network. A tablet must be able to access the computer running the application.

```bash
npm ci
npm run bridge:deps
npm run dev
```

`npm run bridge:deps` downloads the Java dependencies. `npm run dev` builds the
bridge and runs **the web app and Java bridge together in the foreground**.
Both logs stay in the same terminal; `Ctrl+C` stops both processes. `npm start`
is equivalent. Do not run a separate bridge alongside this command.

The web app uses port **4325**. Open the address printed in the terminal.
On a tablet, use `http://<computer-address>:4325/`, replacing the placeholder
with the computer's reachable LAN address. Add `?source=replay` for fixture
playback. If using a custom hostname, check `allowedHosts` in `astro.config.mjs`.

The bridge is restricted to the local computer on port **8787**. The browser
connects through `/events`, which the development server proxies to the bridge
over WebSocket. A static web build alone cannot provide live data: deployment
also requires the running bridge and a corresponding WebSocket proxy.

Java changes require restarting `npm run dev`; web UI changes use HMR during
development. Multiple network adapters on the same subnet can affect adapter
selection and reception. The bridge logs its selected address and player number.

### Development and verification

```bash
npm test
npm run check
npm run bridge:test
npm run fixture:replay
npm run build
```

Tests cover event validation, state transitions, shared live/replay handling and
the Java bridge. Passing fixtures do not replace hardware verification.
See [AGENTS.md](AGENTS.md) and
[.github/copilot-instructions.md](.github/copilot-instructions.md) for project rules.

## Architektur / Architecture

```text
ProDJ Link → Java / beat-link → WebSocket events v2
                                     ↓
Fixture replay → shared parser and session → Astro / Preact UI
```

| Bereich / Area | Aufgabe / Responsibility |
| --- | --- |
| `apps/bridge/` | Java-Adapter und WebSocket-Ereignisse / Java adapter and WebSocket events |
| `src/domain/` | Eventvertrag und Fachmodelle / Event contract and domain models |
| `src/application/` | Gemeinsame Session und Zustandswechsel / Shared session and state transitions |
| `src/infrastructure/` | Live-Transport und Replay / Live transport and replay |
| `src/components/`, `src/styles/` | Oberfläche / User interface |
| `scripts/` | Entwicklungs-, Build- und Testbefehle / Development, build and test commands |

## Besonderer Dank / Special Thanks

Dieses Projekt profitiert von offenen Bibliotheken, öffentlich dokumentierten
Protokollen und dem Austausch in der DJ- und Entwicklergemeinschaft.
Vielen Dank an die Menschen und Projekte, die diese Arbeit ermöglichen und inspirieren.

This project benefits from open libraries, publicly documented protocols and
knowledge shared by the DJ and developer communities. Thank you to the people
and projects that make this work possible and inspire its development.

- [Deep Symmetry / beat-link](https://github.com/Deep-Symmetry/beat-link) –
  die Java-Bibliothek unserer Bridge / the Java library powering our bridge.
- [DJ Link Ecosystem Analysis](https://djl-analysis.deepsymmetry.org/) –
  öffentliche Protokollanalyse / public protocol research.
- [chrisle / rbxport](https://github.com/chrisle/rbxport) –
  Inspiration und Architekturimpulse / inspiration and architectural ideas.
- [evanpurkhiser / prolink-connect](https://github.com/evanpurkhiser/prolink-connect) –
  offene ProDJ-Link-Implementierung / an open ProDJ Link implementation.

Special thanks to **evanpurkhiser, Maddix, Morgan Page, nichi, profbx,
Sean Tyas, shiz, syl, trancejesus, xorbxbx, and [AlphaTheta](https://alphatheta.com/)**.

Die Danksagung stellt keine offizielle Beteiligung oder Unterstützung dar.
These acknowledgements do not imply official involvement or endorsement.

## Lizenz / License

[MIT](LICENSE). Abhängigkeiten unterliegen ihren jeweiligen Lizenzen.
Dependencies retain their respective licenses.
