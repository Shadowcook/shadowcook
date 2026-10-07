import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createApi } from '../../src/app.js';
import type { RegistrationConfig } from '../../src/config.js';

const testRegistrationConfig: RegistrationConfig = {
  turnstileSiteKey: '',
  pendingLifetimeMilliseconds: 24 * 60 * 60 * 1000,
  shortWindowMilliseconds: 15 * 60 * 1000,
  shortWindowRequests: 5,
  dailyWindowMilliseconds: 24 * 60 * 60 * 1000,
  dailyWindowRequests: 20,
  resendWindowMilliseconds: 60 * 60 * 1000,
  resendRequests: 3,
  turnstileSecret: '',
};

export function createTestApi(pool: Pool): FastifyInstance {
  return createApi(
    pool,
    false,
    Buffer.alloc(32, 7),
    'http://test-web.invalid',
    'http://test-api.invalid',
    testRegistrationConfig,
  );
}
