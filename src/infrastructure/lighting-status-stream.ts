import type { ServerResponse } from 'node:http';
import type { LightingOutputStatus } from '../domain/lighting-output-status';

/** At most one pending snapshot per slow reader; never queue old frames. */
export class LightingStatusStream {
  private clients = new Map<ServerResponse, { blocked: boolean; pending: string | null; drain: () => void; close: () => void }>();
  private last = '';

  connect(response: ServerResponse, status: LightingOutputStatus) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    response.flushHeaders();
    const client = { blocked: false, pending: null as string | null, drain: () => {
      client.blocked = false;
      if (client.pending) { const value = client.pending; client.pending = null; client.blocked = !response.write(value); }
    }, close: () => {
      response.removeListener('drain', client.drain);
      this.clients.delete(response);
    } };
    this.clients.set(response, client);
    response.on('drain', client.drain);
    response.once('close', client.close);
    client.blocked = !response.write(this.encode(status));
  }

  publish(status: LightingOutputStatus) {
    if (!this.clients.size) return;
    const value = this.encode(status);
    if (value === this.last) return;
    this.last = value;
    for (const [response, client] of this.clients) {
      if (client.blocked) client.pending = value;
      else client.blocked = !response.write(value);
    }
  }

  close() {
    for (const [response, client] of this.clients) {
      client.close();
      response.removeListener('close', client.close);
      response.end();
    }
  }

  private encode(status: LightingOutputStatus) { return `data: ${JSON.stringify(status)}\n\n`; }
}
