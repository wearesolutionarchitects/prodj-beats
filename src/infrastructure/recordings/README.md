# Anonymized hardware recording

`master-switch.json` is a selected event-v2 recording from a physical XDJ-XZ
session on 2026-10-14. It includes the last device/track reports preceding the
selection, beats, on-air reports and the actual tempo-master changes 1 → 2 → 1.
No event payload is generated to imitate a hardware result.

Before committing, timestamps were shifted to a relative origin, the device
name replaced with `Controller A`, IP addresses replaced with the documentation
address `203.0.113.10`, track IDs consistently remapped, track titles replaced,
and artist/album/year/media fields and cue details removed. Audio and artwork
are not included. Player numbers, musical timing, pitch and handoff values
remain so the original transitions can be reproduced.

The regression tests add clearly synthetic fault scenarios (duplicate/stale
reports, loss/reconnect and late assets). Structured bridge diagnostics are
also synthetic test inputs: this older hardware recording predates that event.
They are not claimed as captured hardware evidence.
