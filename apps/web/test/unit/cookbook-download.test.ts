import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { downloadCookbook } from '../../src/features/cookbook/model/download-cookbook.ts';
import { ApiRequestError } from '../../src/lib/api/client.ts';

test('download retains the binary ZIP and attachment filename through the browser', async (context: TestContext): Promise<void> => {
  const bytes: Uint8Array = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0xff]);
  const filename: string = 'my-cookbook-20261013T190000Z.shadowcook.zip';
  context.mock.method(
    globalThis,
    'fetch',
    async (url: string, options: RequestInit): Promise<Response> => {
      assert.equal(url, '/api/cookbook/tenants/my-cookbook/export');
      assert.equal(options.credentials, 'same-origin');
      return new Response(bytes, {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${filename}"`,
        },
      });
    },
  );
  let downloaded: boolean = false;
  let removed: boolean = false;
  let appended: boolean = false;
  let cleanup: (() => void) | undefined;
  const link: { href: string; download: string; click: () => void; remove: () => void } = {
    href: '',
    download: '',
    click: (): void => {
      assert.equal(appended, true);
      downloaded = true;
    },
    remove: (): void => {
      removed = true;
    },
  };
  const documentDescriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const windowDescriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(
    globalThis,
    'window',
  );
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: (tag: string): typeof link => {
        assert.equal(tag, 'a');
        return link;
      },
      body: {
        append: (element: typeof link): void => {
          assert.equal(element, link);
          appended = true;
        },
      },
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout: (callback: () => void): number => {
        cleanup = callback;
        return 1;
      },
    },
  });
  context.after((): void => {
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  let blob: Blob | undefined;
  context.mock.method(URL, 'createObjectURL', (content: Blob): string => {
    blob = content;
    return 'blob:test-download';
  });
  const revoke: { mock: { callCount(): number } } = context.mock.method(
    URL,
    'revokeObjectURL',
    (): void => {},
  );
  await downloadCookbook('my-cookbook');
  assert.equal(link.download, filename);
  assert.equal(link.href, 'blob:test-download');
  assert.equal(downloaded, true);
  assert.equal(removed, true);
  assert.ok(blob);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  assert.equal(revoke.mock.callCount(), 0);
  assert.ok(cleanup);
  cleanup();
  assert.equal(revoke.mock.callCount(), 1);
});

test('download exposes only an API error code for localization', async (context: TestContext): Promise<void> => {
  context.mock.method(
    globalThis,
    'fetch',
    async (): Promise<Response> =>
      new Response(
        JSON.stringify({ code: 'TENANT_PERMISSION_REQUIRED', error: 'Untranslated server error' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
  );
  await assert.rejects(downloadCookbook('private-cookbook'), (error: unknown): boolean => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.code, 'TENANT_PERMISSION_REQUIRED');
    assert.equal(error.message, 'TENANT_PERMISSION_REQUIRED');
    return true;
  });
});

test('HTML redirects and non-JSON errors cannot become broken cookbook archives', async (context: TestContext): Promise<void> => {
  for (const status of [200, 502]) {
    context.mock.method(
      globalThis,
      'fetch',
      async (): Promise<Response> =>
        new Response('<html>Sign in</html>', { status, headers: { 'content-type': 'text/html' } }),
    );
    await assert.rejects(
      downloadCookbook('my-cookbook'),
      (error: unknown): boolean =>
        error instanceof ApiRequestError && error.code === 'REQUEST_FAILED',
    );
  }
});
