import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import proxyAddress from '@fastify/proxy-addr';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { HttpProxy } from 'vite';
import { configuredWebProxies, sanitizeClientAddress } from './src/lib/server/client-address';

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
  devToolbar: { enabled: false },
  output: 'server',
  publicDir: './src/assets',
  integrations: [react()],
  security: {
    checkOrigin: false,
    allowedDomains: allowedPublicDomain(process.env.PUBLIC_WEB_ORIGIN),
  },
  vite: {
    optimizeDeps: {
      include: [
        '@fortawesome/fontawesome-svg-core',
        '@fortawesome/free-solid-svg-icons',
        '@fortawesome/react-fontawesome',
        'pdfmake/build/pdfmake.js',
        'pdfmake/build/vfs_fonts.js',
      ],
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          rewrite: (path: string): string => path.replace(/^\/api/, ''),
          configure: (proxy: HttpProxy.Server): void => {
            const trust: (address: string, hop: number) => boolean = proxyAddress.compile(
              configuredWebProxies(process.env),
            );
            proxy.on('proxyReq', (proxyRequest: ClientRequest, request: IncomingMessage): void => {
              sanitizeClientAddress(request, trust);
              proxyRequest.setHeader('x-forwarded-for', request.headers['x-forwarded-for']!);
              proxyRequest.removeHeader('forwarded');
              proxyRequest.removeHeader('x-real-ip');
            });
          },
        },
      },
    },
  },
});
