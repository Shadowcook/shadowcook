import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

interface AllowedDomain {
  hostname: string;
  port?: string;
  protocol: 'http' | 'https';
}

function allowedPublicDomain(originValue: string | undefined): AllowedDomain[] {
  if (originValue === undefined || originValue.length === 0) {
    return [];
  }

  let origin: URL;
  try {
    origin = new URL(originValue);
  } catch {
    throw new Error('PUBLIC_WEB_ORIGIN must be an absolute HTTP or HTTPS URL.');
  }

  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    throw new Error('PUBLIC_WEB_ORIGIN must use HTTP or HTTPS.');
  }

  const protocol: 'http' | 'https' = origin.protocol === 'http:' ? 'http' : 'https';
  const allowedDomain: AllowedDomain = {
    hostname: origin.hostname,
    protocol,
  };

  if (origin.port.length > 0) {
    allowedDomain.port = origin.port;
  }

  return [allowedDomain];
}

export default defineConfig({
  adapter: node({ mode: 'standalone' }),
  output: 'server',
  integrations: [react()],
  security: {
    allowedDomains: allowedPublicDomain(process.env.PUBLIC_WEB_ORIGIN),
  },
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
