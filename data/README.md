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

Der Cache wird noch nicht automatisch in Live-/Replay-Ereignisse eingemischt und
ändert keine laufende Ausgabe. Die bestätigte Trackverknüpfung und ein kanonisches
Anreicherungsereignis müssen vor der automatischen Nutzung eingeführt werden.
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
stored. This persistence layer does not yet enrich live/replay events or change
hardware output. Automatic integration requires verified track matching and a
shared canonical enrichment event. Original device catalogs and venue setups
are excluded. Tests contain synthetic data only.
