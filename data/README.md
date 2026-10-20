# Lokaler Lighting-Cache / Local lighting cache

`lighting.sqlite` enthält private rekordbox-Lightingdaten und bleibt außerhalb
von Git, einschließlich Journaldateien. Schema und Zugriff liegen in
`src/infrastructure/lighting-database.ts` (Schema-Version 1, Node `node:sqlite`,
keine zusätzliche Dependency). Die Originaldatenbanken werden nie beschrieben.

Import aus konsistenten Kopien von `LightingDB/user.db3` und `macro.db3`, ohne
aktive WAL-/Journaldateien, im Projektordner:

```sh
npm run lighting:import -- /path/to/snapshot/user.db3 /path/to/snapshot/macro.db3
```

Der transaktionale Import bewahrt Track-/Phrasenzuordnungen, Initialmakros,
Lightingdaten, Makro-Pattern, Zuordnungen, Geräte-Rollen und Makro-Timelines in
`rb_*`-Tabellen. `source_snapshot` enthält Pfad, SHA-256, Größe und Importzeit.
Identische Snapshots werden nicht erneut geschrieben; Fehler rollen den gesamten
Refresh zurück. `track_identity` hält ausdrücklich bestätigte lokale Identitäten
und deren Nachweis. `lookup(masterDbId,songId)` erfordert eine eindeutige lokale
Bibliotheksidentität; Player-/Slot-/Export-IDs sind keine globale Track-ID.

Banknummern werden aus `macro_pattern.pattern` interpretiert: 1 cool, 2 natural,
3 hot, 4 subtle, 5 warm, 6 vivid, 7 club-1, 8 club-2. Andere Werte bleiben unbekannt.
`macro_pattern_id` ist ein separater Schlüssel und keine Banknummer. Eigene
Phrasen-Overrides bleiben mit `macro_id` und `initial_macro_id` erhalten.

`CachedEventSource` reichert Live und Replay über denselben Parser/Session-Fluss
an. Titel, Künstler, exakte Dauer in Millisekunden und SHA-256 von
`JSON.stringify(phrases)` müssen genau einer bestätigten `track_identity` entsprechen.
Keine unscharfe Suche, keine Gleichsetzung von Export- und Bibliotheksnummern.
Fehlende, mehrdeutige oder nicht verfügbare Treffer ändern die Player-Bank nicht.
Der bestehende App-Server öffnet ausschließlich `data/lighting.sqlite` lesend und
stellt `POST /api/lighting-cache` bereit; der zentrale Sender nutzt denselben Resolver.
Ereignisse bleiben bis zum Ende einer Abfrage geordnet; HTTP-Abfragen brechen nach
zwei Sekunden ab. Verbindungsverlust oder Abmelden verwirft ausstehende Antworten.

Das kanonische v2-`structure`-Ereignis behält `bank` als Player-Wert. Das optionale
`cachedBank` enthält die effektive Bank, `origin=sqlite`, lokale Bibliotheks-/Song-ID
und die SHA-256-Werte des User- und Makro-Snapshots. So kann eine angereicherte Aufzeichnung auch
ohne lokale Datenbank wiedergegeben werden. Die Session zeigt effektive Bank und
Herkunft, die GUI zusätzlich den Player-Wert. Trackwechsel, Entladen und
Verbindungsverlust entfernen die Zuordnung mit den übrigen Track-Assets.
Bestehende Regeln für Bankwechsel auf Beat 1 gelten auch für Cache-Banken.
Makro-Timelines sind persistiert, werden aber noch nicht als Original-Lichtshow
abgespielt. Neu angelegte oder ersetzte Cache-Dateien erfordern einen Neustart des
bestehenden gemeinsamen Dev-Prozesses; laufende Lookup-Ergebnisse werden pro
Subscription begrenzt zwischengespeichert.
Es wird keine SQLCipher-Zugangsinformation gespeichert. `master.db3` des
rekordbox-Gerätekatalogs und private Venue-/Gerätekonfigurationen sind nicht Teil
des Imports. Öffentliche Beispiele und Tests verwenden ausschließlich synthetische Daten.

## English

`lighting.sqlite` is a private local cache, excluded from Git with its journals.
The versioned schema and repository use Node's built-in `node:sqlite` without new
dependencies. Run the command above with consistent copies of LightingDB's
`user.db3` and `macro.db3`. Sources open read-only; active WAL/journals are rejected.
Imports are atomic, retain source hashes and timestamps, and skip identical data.
Track/phrase assignments, overrides and macro timelines are preserved in `rb_*`
tables. Confirmed identities and their evidence live in `track_identity`.

Lookups require the pair `(master_db_id,song_id)` from the local library. Export
IDs or player slots must not be assumed equivalent. Bank comes from the pattern's
`pattern` field, not its `id`; unknown values stay unknown. No credentials are
stored. `CachedEventSource` enriches live and replay through the same parser and
session, including the central lighting sender. Exact title, artist, duration in
milliseconds and the complete phrase JSON SHA-256 must match one verified identity.
Missing, ambiguous or unavailable results preserve the player bank. Runtime cache
access is read-only; original databases are never accessed. The existing app server
provides `POST /api/lighting-cache`; HTTP lookups time out after two seconds, keep
events ordered and discard pending results on disconnect/unsubscribe.

The optional v2 structure `cachedBank` records the override and snapshot provenance,
while `bank` retains the player value. Enriched recordings can replay without the
local database. The GUI labels the source and original bank. Track change, unload
and connection loss clear the association; style changes still latch on beat 1.
Persisted macro timelines are not yet played as original rekordbox light shows.
Restart the existing shared dev process after creating/replacing a cache; lookup
results use a bounded per-subscription memo. Original device catalogs and venue
setups are excluded. Tests contain synthetic data only.

## Weitere Tracks mit der lokalen Bibliothek abgleichen / Synchronize more tracks

Im Projektordner, nach dem Import der Lighting-Snapshots:

```sh
npm run bridge:build
npm run lighting:sync -- /path/to/snapshot/master.db /path/to/rekordbox/share
```

Der erste Befehl kompiliert auch den Offline-Indexer; er startet keine Bridge.
Bei verschlüsselten Bibliothekskopien benötigt der zweite Befehl das vorhandene
`sqlcipher` und den Schlüssel in der Umgebungsvariable `REKORDBOX_DB_KEY`.
Optional wählt `SQLCIPHER_BINARY` das SQLCipher-Programm. Keine Schlüssel in
Repository-Dateien, Befehlsargumenten oder Logs speichern. Unverschlüsselte
SQLite-Kopien funktionieren über Node ohne SQLCipher. Nur konsistente Snapshots
verwenden; aktive WAL-/Journaldateien werden abgewiesen.

Der Abgleich verbindet `djmdContent.MasterDBID` und `MasterSongID` mit den
Lighting-Einträgen und liest Künstler, Titel, Dauer sowie `AnalysisDataPath`.
Unterhalb des angegebenen Analyse-Verzeichnisses wird die passende `.EXT` gelesen.
Der vorhandene crate-digger-Parser und die Phrasennormalisierung der Java-Bridge
bilden den identischen kanonischen Fingerabdruck. Mehrdeutige Bibliotheks-IDs,
fehlende Metadaten/Analysen, defekte Analysen und Pfade außerhalb dieses
Verzeichnisses werden nicht als Zuordnung übernommen. Auch nach dem Abgleich
bleiben identische Metadaten plus Phrasen mehrerer Bibliothekseinträge mehrdeutig.

Die Zuordnungen tragen Bibliotheks- und Analyse-SHA-256 als Nachweis. Generierte
Zuordnungen werden transaktional ersetzt; andere bestätigte Nachweise bleiben
erhalten. Unveränderte Ergebnisse schreiben die Cache-Datei nicht erneut. Vor dem
ersten Abgleich entsteht die private Sicherung `lighting.sqlite-library-sync-backup`
(neben dem Cache, ebenfalls von Git ausgeschlossen). Es werden keine Original-
Bibliotheken, Analysen oder LightingDB-Dateien verändert, keine Netzwerke oder
Hardware angesprochen und keine rekordbox-Makros als Lichtshow abgespielt.
Neue, bisher noch nicht abgefragte Tracks können den aktualisierten Cache direkt
nutzen. Bereits pro Subscription zwischengespeicherte Ergebnisse benötigen einen
Neustart des gemeinsamen Dev-Prozesses, insbesondere frühere Nichttreffer.

From the repository root, run the commands above after importing lighting snapshots.
The offline Java indexer uses the same crate-digger parser and phrase normalization
as the live bridge, without starting network services. Encrypted library snapshots
require the existing SQLCipher CLI and `REKORDBOX_DB_KEY` environment variable;
plain SQLite snapshots use Node directly. Never store keys in the repository or logs.
The sync joins library `MasterDBID`/`MasterSongID` to lighting entries, with exact
metadata and a full canonical phrase fingerprint from each referenced `.EXT`.
Missing/corrupt analyses, unsafe paths and ambiguous identities remain unmatched.
Library and analysis hashes preserve evidence. Generated mappings refresh atomically;
unchanged results leave the cache bytes intact. A private, Git-ignored backup is
created before the first sync. Original files and hardware are never modified.
New tracks use the updated cache on load; restart the shared dev process to clear
previous per-subscription lookup results, including earlier misses.

Parser reference: [crate-digger](https://github.com/Deep-Symmetry/crate-digger).
Library schema reference: [pyrekordbox master database](https://pyrekordbox.readthedocs.io/en/latest/tutorial/db6.html).
