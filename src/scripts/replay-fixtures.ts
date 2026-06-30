import { ProDjLinkSession } from '../application/session';
import { fixtureEvents } from '../infrastructure/fixtures';

const session = new ProDjLinkSession();

for (const event of fixtureEvents) {
  session.apply(event);
}

console.log(JSON.stringify(session.snapshot(), null, 2));
