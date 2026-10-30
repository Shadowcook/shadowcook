import { createServer } from 'node:http';
import type { RequestListener, Server } from 'node:http';
import { configuredWebProxies, createProxyAwareHandler } from './src/lib/server/client-address.ts';

process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const entrypoint: URL = new URL('./dist/server/entry.mjs', import.meta.url);
const runtime: { handler: RequestListener } = await import(entrypoint.href);
const server: Server = createServer(
  createProxyAwareHandler(runtime.handler, configuredWebProxies(process.env)),
);
const port: number = Number(process.env.PORT ?? '4321');
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be an integer between 1 and 65535.');

server.listen(port, process.env.HOST ?? '0.0.0.0');
