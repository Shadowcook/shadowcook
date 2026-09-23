import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  adapter: node({ mode: 'standalone' }),
  output: 'server',
  integrations: [react()],
  vite: {
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          rewrite: (path: string): string => path.replace(/^\/api/, ''),
        },
      },
    },
  },
});
