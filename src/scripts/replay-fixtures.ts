import { readFileSync } from 'node:fs';
import { ProDjLinkSession } from '../application/session';
import { observeSession } from '../application/event-source';
import { ReplayEventSource } from '../infrastructure/event-sources';
import { fixtureEvents } from '../infrastructure/fixtures';

const path = process.argv[2];
const events: unknown[] = path ? readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line)) : fixtureEvents;
const session = new ProDjLinkSession();
observeSession(new ReplayEventSource(events, 0), session, () => {}, () => {});
console.log(JSON.stringify(session.snapshot(), null, 2));
