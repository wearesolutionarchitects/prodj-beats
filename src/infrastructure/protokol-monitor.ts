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
      const sink = await LightingOutput.open(env);
      server.middlewares.use('/api/lighting-output', (request, response) => {
        if (request.method !== 'GET') { response.statusCode = 405; response.end(); return; }
        if (request.url?.split('?')[0] === '/events') { stream.connect(response, sink.status()); return; }
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify(sink.status()));
      });
      monitor = new LightingMonitor(new WebSocketEventSource('ws://127.0.0.1:8787/events'), sink);
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
