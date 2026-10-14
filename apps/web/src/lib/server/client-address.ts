import proxyAddress from '@fastify/proxy-addr';
import { isIP } from 'node:net';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';

export function configuredWebProxies(environment: NodeJS.ProcessEnv): string[] {
  return (environment.SHADOWCOOK_WEB_TRUSTED_PROXIES ?? '')
    .split(',')
    .map((address: string): string => address.trim())
    .filter((address: string): boolean => address.length > 0);
}

export function sanitizeClientAddress(
  request: IncomingMessage,
  trust: (address: string, hop: number) => boolean,
): void {
  const candidate: string = proxyAddress(request, trust);
  let clientAddress: string =
    isIP(candidate) === 0 ? (request.socket.remoteAddress ?? '127.0.0.1') : candidate;
  if (clientAddress.toLowerCase().startsWith('::ffff:') && isIP(clientAddress.slice(7)) === 4)
    clientAddress = clientAddress.slice(7);
  request.headers['x-forwarded-for'] = clientAddress;
  delete request.headers.forwarded;
  delete request.headers['x-real-ip'];
}

export function createProxyAwareHandler(
  handler: RequestListener,
  trustedProxies: string[],
): RequestListener {
  const trust: (address: string, hop: number) => boolean = proxyAddress.compile(trustedProxies);
  return (request: IncomingMessage, response: ServerResponse): void => {
    sanitizeClientAddress(request, trust);
    handler(request, response);
  };
}
