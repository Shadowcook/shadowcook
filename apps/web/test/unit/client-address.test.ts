import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import proxyAddress from '@fastify/proxy-addr';
import {
  configuredWebProxies,
  sanitizeClientAddress,
} from '../../src/lib/server/client-address.ts';

test('direct clients cannot select their IP through forwarded headers', (): void => {
  const request: IncomingMessage = requestFrom('198.51.100.10', '203.0.113.1');
  request.headers.forwarded = 'for=203.0.113.2';
  request.headers['x-real-ip'] = '203.0.113.3';
  sanitizeClientAddress(request, proxyAddress.compile([]));
  assert.equal(request.headers['x-forwarded-for'], '198.51.100.10');
  assert.equal(request.headers.forwarded, undefined);
  assert.equal(request.headers['x-real-ip'], undefined);
});

test('trusted proxy chains resolve from the socket to the first untrusted address', (): void => {
  const request: IncomingMessage = requestFrom('127.0.0.1', '203.0.113.1, 198.51.100.11, 10.0.0.2');
  sanitizeClientAddress(request, proxyAddress.compile(['loopback', '10.0.0.2']));
  assert.equal(request.headers['x-forwarded-for'], '198.51.100.11');
});

test('IPv4-mapped addresses normalize to IPv4 and malformed forwarded IPs fall back to the peer', (): void => {
  const mapped: IncomingMessage = requestFrom('::ffff:198.51.100.12');
  sanitizeClientAddress(mapped, proxyAddress.compile([]));
  assert.equal(mapped.headers['x-forwarded-for'], '198.51.100.12');
  const malformed: IncomingMessage = requestFrom('127.0.0.1', 'malformed-ip');
  sanitizeClientAddress(malformed, proxyAddress.compile(['loopback']));
  assert.equal(malformed.headers['x-forwarded-for'], '127.0.0.1');
});

test('proxy trust defaults to no forwarded-header trust and accepts explicit IPs and CIDRs', (): void => {
  assert.deepEqual(configuredWebProxies({}), []);
  assert.deepEqual(
    configuredWebProxies({ SHADOWCOOK_WEB_TRUSTED_PROXIES: '127.0.0.1, 10.0.0.0/24, ' }),
    ['127.0.0.1', '10.0.0.0/24'],
  );
});

function requestFrom(remoteAddress: string, forwardedFor?: string): IncomingMessage {
  const socket: Socket = new Socket();
  Object.defineProperty(socket, 'remoteAddress', { value: remoteAddress });
  const request: IncomingMessage = new IncomingMessage(socket);
  if (forwardedFor !== undefined) request.headers['x-forwarded-for'] = forwardedFor;
  return request;
}
