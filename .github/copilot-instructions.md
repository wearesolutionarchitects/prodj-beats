# ProDJ Beats – verbindlicher Entwicklungsworkflow

## Zusammenarbeit und Prozesse

- Der Nutzer entwickelt in VS Code auf dem Mac Studio. Das integrierte zsh-Terminal ist die zentrale Stelle für Server und Logs.
- Vor Änderungen `git status --short` und den betroffenen Quellcode prüfen. Zwischen Aufträgen kann der Nutzer Dateien ändern, committen und pushen; den aktuellen Stand neu lesen.
- Bestehenden Dev-Server auf Port 4325 und bestehende Bridge auf Port 8787 verwenden. Vor einer Browserprüfung den Status prüfen, keinen zweiten Server starten.
- Keine eigenen Hintergrundserver, versteckten Prozesse, alternativen Ports, temporären HTTP-Server oder in Dateien umgeleiteten Laufzeitprozesse starten.
- `npm run dev` (auch `npm start`) ist der gemeinsame Vordergrund-Start für Web-App und Java-Bridge im VS-Code-Terminal; beide Logs bleiben dort sichtbar, `Ctrl+C` beendet beide. Kein zusätzlicher `bridge:run`-Prozess daneben.
- Dev-Server und Bridge werden vom Nutzer über diesen gemeinsamen Befehl gestartet. Für einen erforderlichen Neustart den konkreten Befehl nennen; laufende Prozesse nur auf ausdrücklichen Auftrag stoppen oder ersetzen.
- Der direkte Astro-CLI-Aufruf kann aus Agent-Umgebungen automatisch im Hintergrund landen; der gemeinsame Starter nutzt deshalb die Astro-API im Vordergrund. Deshalb einen Server nicht aus Agent-Tools starten, auch nicht vermeintlich im Vordergrund. Kein `--force`, `--ignore-lock` oder Löschen der Lockdatei als Umgehung.
- Nach einer Änderung prüfen, ob HMR greift. Vite aktualisiert nur die Web-App; Java-Änderungen erfordern Build und Bridge-Neustart. Nicht behaupten, eine laufende JVM verwende bereits neu kompilierten Code.
- Keine Netzwerkadapter, Firewall-, Routing-, Anmelde- oder Systemeinstellungen eigenständig ändern.

## Projekt und Architektur

- KISS/DRY: vorhandene zentrale Flüsse erweitern, keine parallelen Implementierungen oder neuen Frameworks ohne konkreten Bedarf.
- Astro/Preact rendert die UI. Reine TypeScript-Domain und Application halten Eventvertrag, Session und Zustandswechsel. Java/beat-link bleibt hinter der Bridge-Grenze.
- Live und Replay verwenden dieselbe EventSource-Schnittstelle, denselben Parser und dieselbe Session. Keine direkte WebSocket-Verarbeitung in UI-Komponenten.
- Eventvertrag v2 beibehalten: `beatWithinBar` = 1–4, `trackBeat` = absolute 1-basierte Position; unbekannte Werte bleiben `null`. Die Werte niemals austauschen oder schätzen.
- Tracks über `{ id, player, slot }` zuordnen. Trackwechsel, Entladen und Verbindungsverlust müssen abhängige Daten bereinigen; verspätete fremde Assets dürfen den Zustand nicht überschreiben.
- Gerätenamen und IP-Adressen aus Geräteankündigungen übernehmen. Logische Player desselben Geräts in der Verbindungsübersicht nach IP zusammenfassen.
- Web-App: Port 4325, LAN-Zugriff über `http://macstudio.local:4325/`. Replay: `?source=replay`. WebSocket `/events` läuft über den Dev-Proxy zur lokalen Bridge `127.0.0.1:8787`.
- Ethernet und WLAN können dasselbe Subnetz bedienen und doppelte Pro-DJ-Link-Pakete verursachen. Beobachtungen benennen; keine Netzwerkumstellung daraus ableiten.

## Prüfung und Git

- Relevante Regressionstests ergänzen. Je nach Änderung `npm test`, `npm run check`, `npm run bridge:test`, `npm run build` und `git diff --check` verwenden.
- Browserprüfungen am bestehenden Server mit Chrome durchführen. Nach Änderungen DOM, sichtbare Werte und Konsole prüfen; einen Reload nur bei Bedarf ausführen.
- Fixture-/Mock-Erfolg ist kein Hardwarebeleg. Ergebnisse und offene Grenzen präzise benennen, fehlende Metadaten nicht durch erfundene Werte ersetzen.
- Keine fremden Änderungen überschreiben, zurücksetzen, stagen oder mitcommitten. Nur ausdrücklich beauftragten Umfang committen/pushen. Vorher staged Diff prüfen, anschließend Commit und Reststatus verifizieren.
- Kurz und konkret berichten: Änderung, geprüfter Zustand, relevante Einschränkung. Bei ungelöstem Fehler Ursache weiter untersuchen statt vorschnell Erfolg melden.
