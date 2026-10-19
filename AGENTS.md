# ProDJ Beats – verbindlicher Entwicklungsworkflow

Diese Datei ist die zentrale Quelle dauerhafter Repository-Regeln für Codex,
GitHub Copilot und andere Coding-Agenten. Aktuelle ausdrückliche Nutzeraufträge
gehen vor. Fachdetails stehen in der Projektdokumentation; keine parallelen
Regelkopien oder historischen Aufgabenstände in Tool-Anweisungen pflegen.

## Zusammenarbeit und Prozesse

- Der Nutzer entwickelt in VS Code auf dem Mac Studio. Das integrierte zsh-Terminal ist die zentrale Stelle für Server und Logs.
- Vor Änderungen Arbeitsverzeichnis, Branch, `git status --short` und den betroffenen Quellcode prüfen. Den vom Nutzer genannten Checkout verwenden; angehängte Worktrees können veraltet sein. Zwischen Aufträgen kann der Nutzer Dateien ändern, committen und pushen; den aktuellen Stand neu lesen.
- Bestehenden Dev-Server auf Port 4325 und bestehende Bridge auf Port 8787 verwenden. Vor einer Browserprüfung den Status prüfen, keinen zweiten Server starten.
- Keine eigenen Hintergrundserver, versteckten Prozesse, alternativen Ports, temporären HTTP-Server oder in Dateien umgeleiteten Laufzeitprozesse starten.
- `npm run dev` (auch `npm start`) ist der gemeinsame Vordergrund-Start für Web-App und Java-Bridge im VS-Code-Terminal; beide Logs bleiben dort sichtbar, `Ctrl+C` beendet beide. Kein zusätzlicher `bridge:run`-Prozess daneben.
- Dev-Server und Bridge werden vom Nutzer über diesen gemeinsamen Befehl gestartet. Für einen erforderlichen Neustart den konkreten Befehl nennen; laufende Prozesse nur auf ausdrücklichen Auftrag stoppen oder ersetzen.
- Der direkte Astro-CLI-Aufruf kann aus Agent-Umgebungen automatisch im Hintergrund landen; der gemeinsame Starter nutzt deshalb die Astro-API im Vordergrund. Deshalb einen Server nicht aus Agent-Tools starten, auch nicht vermeintlich im Vordergrund. Kein `--force`, `--ignore-lock` oder Löschen der Lockdatei als Umgehung.
- Nach einer Änderung prüfen, ob HMR greift. Vite aktualisiert nur die Web-App; Java-Änderungen erfordern Build und Bridge-Neustart. Nicht behaupten, eine laufende JVM verwende bereits neu kompilierten Code.
- Keine Netzwerkadapter, Firewall-, Routing-, Anmelde- oder Systemeinstellungen eigenständig ändern.

- Kleine, konkret prüfbare Schritte im beauftragten Umfang umsetzen. Größere oder fachfremde Verbesserungen als Folgearbeit festhalten; keine großen Refactorings ohne klaren Nutzen.
- Vorgeschlagene Branch-Namen direkt im Chat in einem eigenen kopierbaren Codeblock ausgeben. Standard: `codex/<issue-nummer>-<kurze-beschreibung>`, ohne Issue `codex/<kurze-beschreibung>`. Erstellt der Nutzer den Branch selbst, vor der Implementierung auf dessen Bereitschaft warten.
- GitHub über GH CLI oder eine vom Nutzer autorisierte angemeldete Chrome-Sitzung nutzen. Bestehende Issues und PRs lesen, bevor doppelte Arbeit angelegt wird.
- Issue-Texte kompakt halten: Checklisten für Arbeitspakete und Akzeptanzkriterien vor Ziel und Hintergrund führen, bestehende Checklisten erhalten und Ergebnisse sowie offene Punkte einarbeiten. Bestätigungen nicht vorwegnehmen.
- Befehle, die der Nutzer selbst ausführen soll, direkt im Chat in einem kopierbaren Markdown-Codeblock mit Sprachkennung `sh` ausgeben. Vollständige Befehle ohne Shell-Prompt liefern und das Arbeitsverzeichnis nennen.

## Projekt und Architektur

- KISS/DRY: vorhandene zentrale Flüsse erweitern, keine parallelen Implementierungen oder neuen Frameworks ohne konkreten Bedarf.
- Astro/Preact rendert die UI. Reine TypeScript-Domain und Application halten Eventvertrag, Session und Zustandswechsel. Java/beat-link bleibt hinter der Bridge-Grenze.
- Live und Replay verwenden dieselbe EventSource-Schnittstelle, denselben Parser und dieselbe Session. Keine direkte WebSocket-Verarbeitung in UI-Komponenten.
- Eventvertrag v2 beibehalten: `beatWithinBar` = 1–4, `trackBeat` = absolute 1-basierte Position; unbekannte Werte bleiben `null`. Die Werte niemals austauschen oder schätzen.
- Tracks über `{ id, player, slot }` zuordnen. Trackwechsel, Entladen und Verbindungsverlust müssen abhängige Daten bereinigen; verspätete fremde Assets dürfen den Zustand nicht überschreiben.
- Gerätenamen und IP-Adressen aus Geräteankündigungen übernehmen. Logische Player desselben Geräts in der Verbindungsübersicht nach IP zusammenfassen.
- Web-App: Port 4325, LAN-Zugriff über `http://macstudio.local:4325/`. Replay: `?source=replay`. WebSocket `/events` läuft über den Dev-Proxy zur lokalen Bridge `127.0.0.1:8787`.
- Ethernet und WLAN können dasselbe Subnetz bedienen und doppelte Pro-DJ-Link-Pakete verursachen. Beobachtungen benennen; keine Netzwerkumstellung daraus ableiten.

## Coding und UI/UX

- Vor Codeänderungen vorhandene Struktur und lokale Muster lesen. KISS, DRY, OOP und Divide & Conquer passend zur bestehenden Architektur anwenden; vorhandene Verträge, Komponenten, Adapter und Datenflüsse erweitern.
- Keine neue Dependency einführen, wenn Standardbibliothek oder bestehende Pakete reichen.
- Neue reine Node-Skripte als `.mjs` anlegen; `.ts` für Skripte verwenden, die bewusst TypeScript-Daten oder Typprüfung nutzen. Skripte klein und mit klaren Verantwortlichkeiten halten.
- Generierte Dateien nur schreiben, wenn sich ihr Inhalt tatsächlich geändert hat. Kommentare zur Orientierung in nicht trivialer Logik verwenden.
- Bestehende Astro-, Preact- und CSS-Struktur respektieren. Wiederverwendbare Komponenten und vorhandene Styles bevorzugen; keine lokalen Parallelkomponenten oder dekorativen Effekte ohne konkreten Nutzen.
- Betroffene Ansichten auf Desktop und Tablet prüfen; weitere Zielgrößen am konkreten Anwendungsfall ausrichten. Tastaturbedienung, sichtbaren Fokus, ARIA-Semantik und ausreichende Touch-Ziele erhalten. Entscheidende Aktionen und Hinweise nicht ausschließlich per Hover anbieten.
- Icon-Aktionen mit eindeutigen ARIA-Labels und Tooltips per `title` versehen; bei datensatzbezogenen Aktionen den Datensatzbezug im Label nennen. Rückmeldungen müssen zum tatsächlichen Ergebnis passen.
- Entwicklerdiagnosen gehören ins Log, verständliche Handlungsinformationen in die GUI. Keine Zugangsdaten oder vertraulichen Inhalte loggen.

## Quellen und Dokumentation

- Herkunft, Version und Geltungsbereich von Quellen und Aufzeichnungen erhalten; vorhandene Hashes und Fundstellen mitführen. Unbekannte, nicht verfügbare und widersprüchliche Daten unterscheidbar halten.
- Private Daten, vertrauliche Informationen und lizenzierte Quellen nicht automatisch veröffentlichen. Für öffentliche Beispiele öffentliche oder synthetische Daten verwenden; Hardware-Aufzeichnungen vor Veröffentlichung anonymisieren.
- README und betroffene Fachdokumentation aktualisieren, wenn sich Kommandos, Datenquellen, Regeln oder dokumentiertes Verhalten ändern. Fachdetails dort pflegen und bei Bedarf aus dieser Datei verlinken.
- Aufräumen auf den beauftragten Umfang begrenzen. Original- und Referenzartefakte nicht pauschal formatieren, um historische Befunde zu entfernen.
- Einstiegspunkte: [README](README.md), [Herkunft der Hardware-Aufzeichnungen](src/infrastructure/recordings/README.md). `package.json` ist die aktuelle Kommandoreferenz.

## Prüfung und Git

- Relevante Regressionstests ergänzen. Je nach Änderung `npm test`, `npm run check`, `npm run bridge:test`, `npm run build` und `git diff --check` verwenden.
- Bestehende npm-Kommandos und gezielte Tests zuerst nutzen. Tests müssen Verhalten und relevante Gegenfälle prüfen; bei Fehlern Ursache gegen Quelle und Vertrag prüfen, Erwartungen nicht bloß für grüne Checks lockern. Reine Dokumentationsänderungen durch Inhalts-, Verweis- und Diff-Prüfung absichern.
- Browserprüfungen am bestehenden Server mit Chrome durchführen. Nach Änderungen DOM, sichtbare Werte und Konsole prüfen; einen Reload nur bei Bedarf ausführen.
- Fixture-/Mock-Erfolg ist kein Hardwarebeleg. Ergebnisse und offene Grenzen präzise benennen, fehlende Metadaten nicht durch erfundene Werte ersetzen.
- Commit und Push übernimmt standardmäßig der Nutzer in VS Code; nur auf ausdrücklichen Auftrag selbst ausführen.
- Keine fremden Änderungen überschreiben, zurücksetzen, stagen oder mitcommitten. Nur ausdrücklich beauftragten Umfang committen/pushen. Vorher staged Diff prüfen, anschließend Commit und Reststatus verifizieren.
- Kurz und konkret berichten: Änderung, geprüfter Zustand, relevante Einschränkung. Bei ungelöstem Fehler Ursache weiter untersuchen statt vorschnell Erfolg melden.
- Nach Änderungen den relevanten Diff und `git diff --check` prüfen. Lokale Tests, Remote-CI, Browsernachweis und Hardwareprüfung getrennt berichten; PR, Merge oder Deployment nicht aus bestandenen lokalen Checks ableiten.
