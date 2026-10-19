import type { Plugin } from 'vite';
import { LightingMonitor } from '../application/lighting-monitor';
import { ArtNetAdapter } from './art-net';
import { WebSocketEventSource } from './event-sources';

/** Development-only loopback monitor. No LAN destinations, broadcasts or extra server. */
export function protokolMonitor(): Plugin {
  let monitor: LightingMonitor | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    name: 'prodj-protokol-monitor',
    apply: 'serve',
    async configureServer(server) {
      const sink = await ArtNetAdapter.open({
        address: '127.0.0.1', port: 6454, localAddress: '127.0.0.1', localPort: 0
      });
      monitor = new LightingMonitor(new WebSocketEventSource('ws://127.0.0.1:8787/events'), sink);
      let reported = false;
      timer = setInterval(() => {
        void monitor?.tick().catch(error => {
          if (!reported) server.config.logger.error(`[Protokol] ${error.message}`);
          reported = true;
        });
      }, 1000 / 30);
      server.config.logger.info('[Protokol] Loopback 127.0.0.1:6454 · Universe 0 · L1–R4 · channels 1–64');
    },
    async closeBundle() {
      clearInterval(timer);
      await monitor?.close();
    }
  };
}
