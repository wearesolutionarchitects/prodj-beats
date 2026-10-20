import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { LightingDatabase } from './lighting-database';
import { CachedEventSource } from '../application/cached-event-source';
import { z } from 'zod';
import { phraseSchema } from '../domain/events';
import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { LightingMonitor } from '../application/lighting-monitor';
import { LightingOutput } from './lighting-output';
import { WebSocketEventSource } from './event-sources';
import { LightingStatusStream } from './lighting-status-stream';

/** One development sender; hardware is opt-in. Uses the existing HTTP server. */
export function protokolMonitor(): Plugin {
  let monitor: LightingMonitor | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let env: Record<string, string | undefined> = {};
  const stream = new LightingStatusStream();
  return {
    name: 'prodj-protokol-monitor',
    apply: 'serve',
    configResolved(config) { env = { ...loadEnv(config.mode, config.envDir, ''), ...process.env }; },
    async configureServer(server) {
      const cachePath = resolve(server.config.root, 'data/lighting.sqlite');
      let cache: LightingDatabase | undefined;
      try { if (existsSync(cachePath)) cache = new LightingDatabase(cachePath, true); }
      catch { server.config.logger.warn('[Lighting cache] Unavailable; using player banks'); }
      const lookupSchema = z.object({ title: z.string().min(1), artist: z.string().min(1),
        durationMs: z.number().int().nonnegative(), phrases: z.array(phraseSchema).min(1).max(10000) });
      server.middlewares.use('/api/lighting-cache', (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        if (request.method !== 'POST') { response.statusCode = 405; response.end(); return; }
        let body = '';
        request.on('data', chunk => {
          body += chunk;
          if (body.length > 1024 * 1024) { response.statusCode = 413; response.end(); request.destroy(); }
        });
        request.on('end', () => {
          if (response.writableEnded) return;
          try {
            const identity = lookupSchema.parse(JSON.parse(body));
            response.end(JSON.stringify(cache?.resolveBank(identity) ?? null));
          } catch { response.statusCode = 400; response.end('null'); }
        });
      });
      server.httpServer?.once('close', () => cache?.close());
      const sink = await LightingOutput.open(env);
      server.middlewares.use('/api/lighting-output', (request, response) => {
        if (request.method !== 'GET') { response.statusCode = 405; response.end(); return; }
        if (request.url?.split('?')[0] === '/events') { stream.connect(response, sink.status()); return; }
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify(sink.status()));
      });
      monitor = new LightingMonitor(new CachedEventSource(new WebSocketEventSource('ws://127.0.0.1:8787/events'), async identity => cache?.resolveBank(identity) ?? null), sink);
      let reported = false;
      timer = setInterval(() => {
        stream.publish(sink.status());
        void monitor?.tick().catch(error => {
          if (!reported) server.config.logger.error(`[Protokol] ${error.message}`);
          reported = true;
        });
      }, 1000 / 30);
      server.config.logger.info('[Protokol] Loopback 127.0.0.1:6454 · Universe 0 · L1–R4 · channels 1–64');
      const hardware = sink.status();
      server.config.logger.info(`[Showtec] ${hardware.state} · ${hardware.address ?? 'no address'} · Universe 1${hardware.error ? ` · ${hardware.error}` : ''}`);
    },
    async closeBundle() {
      clearInterval(timer);
      stream.close();
      await monitor?.close();
    }
  };
}
