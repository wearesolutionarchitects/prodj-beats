import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import { protokolMonitor } from './src/infrastructure/protokol-monitor';

export default defineConfig({
  integrations: [preact()],
  server: { host: true, port: 4325, allowedHosts: ['macstudio.local'] },
  vite: {
    plugins: [protokolMonitor()],
    server: {
      strictPort: true,
      proxy: { '/events': { target: 'ws://127.0.0.1:8787', ws: true } }
    }
  },
  output: 'static'
});
