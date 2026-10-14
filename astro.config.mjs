import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

export default defineConfig({
  integrations: [preact()],
  server: { port: 4325 },
  vite: { server: { strictPort: true } },
  output: 'static'
});
