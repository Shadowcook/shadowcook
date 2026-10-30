import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserUuid } from '../../src/lib/browser/uuid.ts';

test('UUID creation works with the crypto API available on HTTP LAN origins', (): void => {
  const cryptoSource: Pick<Crypto, 'getRandomValues'> = {
    getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
  };
  const identifiers: Set<string> = new Set<string>();

  for (let index: number = 0; index < 100; index += 1) {
    const identifier: string = createBrowserUuid(cryptoSource);
    assert.match(
      identifier,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    identifiers.add(identifier);
  }

  assert.equal(identifiers.size, 100);
});

test('UUID creation sets the version and variant bits and preserves leading zeros', (): void => {
  for (const value of [0x00, 0xff]) {
    const cryptoSource: Pick<Crypto, 'getRandomValues'> = {
      getRandomValues<ArrayType extends ArrayBufferView | null>(array: ArrayType): ArrayType {
        assert.ok(array instanceof Uint8Array);
        array.fill(value);
        return array;
      },
    };

    assert.equal(
      createBrowserUuid(cryptoSource),
      value === 0x00
        ? '00000000-0000-4000-8000-000000000000'
        : 'ffffffff-ffff-4fff-bfff-ffffffffffff',
    );
  }
});
