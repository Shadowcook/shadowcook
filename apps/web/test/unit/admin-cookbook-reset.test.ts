import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { en } from '../../src/i18n/en.ts';

interface ElementNode {
  type: unknown;
  props: Record<string, any>;
}

function nodes(tree: ElementNode, type: unknown): ElementNode[] {
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  return [
    ...(tree.type === type ? [tree] : []),
    ...[tree.props.children]
      .flat(Infinity)
      .flatMap((child: ElementNode): ElementNode[] => nodes(child, type)),
  ];
}

// Exercise UI events without starting the project or connecting to its database.
interface RecordedWrite {
  url: string;
  method: string;
  body: string | undefined;
}

async function harness(
  response: Response,
  resetRequired: boolean = false,
  disabled: boolean = false,
): Promise<{ render(): ElementNode; writes(): number; requests(): RecordedWrite[] }> {
  const requests: RecordedWrite[] = [];
  const values: unknown[] = [];
  let cursor: number = 0;
  let writeCount: number = 0;
  let mounted: boolean = false;
  const require = createRequire(import.meta.url);
  const source: string = readFileSync(
    new URL('../../src/features/admin/components/AdminTenantManagement.tsx', import.meta.url),
    'utf8',
  );
  const compiled: string = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const hooks: object = {
    useState(initial: unknown): [unknown, (value: unknown) => void] {
      const index: number = cursor++;
      if (!(index in values)) values[index] = initial;
      return [
        values[index],
        (value: unknown): void => {
          values[index] = value;
        },
      ];
    },
    useEffect(effect: () => void, dependencies: unknown[]): void {
      if (dependencies.length === 0 && !mounted) {
        mounted = true;
        effect();
      }
    },
  };
  const module: { exports: any } = { exports: {} };
  const load = (id: string): unknown => {
    if (id === 'react') return hooks;
    if (id === 'react/jsx-runtime') return require(id);
    if (id.endsWith('/i18n')) return { translations: { en } };
    if (id.endsWith('/use-tenant-slug-availability'))
      return { useTenantSlugAvailability: (): string => 'unavailable' };
    return { default: id };
  };
  const fetch = async (_url: string, options?: RequestInit): Promise<Response> => {
    if (options?.method === 'POST' || options?.method === 'DELETE' || options?.method === 'PATCH') {
      requests.push({
        url: _url,
        method: options.method,
        body: typeof options.body === 'string' ? options.body : undefined,
      });
      writeCount++;
      return response;
    }
    return Response.json({
      tenants: [
        {
          public_id: 'tenant-id',
          display_name: 'My kitchen',
          slug: 'my-kitchen',
          disabled_at: disabled ? '2026-11-10T00:00:00Z' : null,
          name_reset_required: resetRequired,
          recipe_count: 0,
        },
      ],
      smtpConfigured: true,
    });
  };
  new Function('require', 'module', 'exports', 'fetch', compiled)(
    load,
    module,
    module.exports,
    fetch,
  );
  const render = (): ElementNode => {
    cursor = 0;
    return module.exports.default({ locale: 'en' });
  };
  render();
  await new Promise<void>((resolve): void => {
    setImmediate(resolve);
  });
  const edit: ElementNode | undefined = nodes(render(), 'button').find(
    (node: ElementNode): boolean =>
      node.props['aria-label'] ===
      (resetRequired ? en.cookbookIdentity.cancelReset : en.cookbookIdentity.forceReset),
  );
  assert.ok(edit);
  edit.props.onClick();
  return { render, writes: (): number => writeCount, requests: (): RecordedWrite[] => requests };
}

test('administrators confirm a force reset instead of editing a cookbook identity', async (): Promise<void> => {
  const editor: Awaited<ReturnType<typeof harness>> = await harness(
    new Response(null, { status: 204 }),
  );
  let tree: ElementNode = editor.render();
  assert.equal(nodes(tree, 'form').length, 0);
  assert.equal(editor.writes(), 0);
  const dialog: ElementNode = nodes(tree, '../../../components/MessageDialog')[0];
  assert.equal(dialog.props.kind, 'confirmation');
  assert.equal(dialog.props.message, en.cookbookIdentity.resetDescription);
  dialog.props.onConfirm();
  await new Promise<void>((resolve): void => {
    setImmediate(resolve);
  });
  tree = editor.render();
  assert.equal(editor.writes(), 1);
  assert.equal(nodes(tree, '../../../components/MessageDialog').length, 0);
  assert.ok(
    nodes(tree, 'p').some(
      (node: ElementNode): boolean => node.props.children === en.cookbookIdentity.resetDone,
    ),
  );
});

test('a failed force reset preserves the confirmation and displays localized feedback', async (): Promise<void> => {
  const editor: Awaited<ReturnType<typeof harness>> = await harness(
    Response.json({ code: 'SERVER_ERROR' }, { status: 500 }),
  );
  nodes(editor.render(), '../../../components/MessageDialog')[0].props.onConfirm();
  await new Promise<void>((resolve): void => {
    setImmediate(resolve);
  });
  const tree: ElementNode = editor.render();
  assert.equal(editor.writes(), 1);
  assert.equal(nodes(tree, '../../../components/MessageDialog').length, 1);
  assert.ok(
    nodes(tree, 'p').some(
      (node: ElementNode): boolean => node.props.children === en.errors.requestFailed,
    ),
  );
});

test('a pending reset offers cancellation with a confirmation and uses DELETE', async (): Promise<void> => {
  const editor: Awaited<ReturnType<typeof harness>> = await harness(
    new Response(null, { status: 204 }),
    true,
  );
  const tree: ElementNode = editor.render();
  const dialog: ElementNode = nodes(tree, '../../../components/MessageDialog')[0];
  assert.equal(dialog.props.title, en.cookbookIdentity.cancelReset);
  assert.equal(dialog.props.message, en.cookbookIdentity.cancelResetDescription);
  assert.ok(
    nodes(tree, 'p').some(
      (node: ElementNode): boolean => node.props.children === en.cookbookIdentity.resetPending,
    ),
  );
  dialog.props.onConfirm();
  await new Promise<void>((resolve): void => {
    setImmediate(resolve);
  });
  assert.deepEqual(editor.requests(), [
    { url: '/api/admin/tenants/tenant-id/force-reset', method: 'DELETE', body: undefined },
  ]);
  assert.ok(
    nodes(editor.render(), 'p').some(
      (node: ElementNode): boolean => node.props.children === en.cookbookIdentity.resetCancelled,
    ),
  );
});

test('a disabled cookbook with a pending reset exposes a separate enable action', async (): Promise<void> => {
  const editor: Awaited<ReturnType<typeof harness>> = await harness(
    new Response(null, { status: 204 }),
    true,
    true,
  );
  const tree: ElementNode = editor.render();
  const enable: ElementNode | undefined = nodes(tree, 'button').find(
    (node: ElementNode): boolean => node.props['aria-label'] === en.dashboard.enable,
  );
  assert.ok(enable);
  assert.ok(
    nodes(tree, 'p').some(
      (node: ElementNode): boolean => node.props.children === en.cookbookIdentity.disabled,
    ),
  );
  enable.props.onClick();
  await new Promise<void>((resolve): void => {
    setImmediate(resolve);
  });
  assert.deepEqual(editor.requests(), [
    {
      url: '/api/admin/tenants/tenant-id',
      method: 'PATCH',
      body: JSON.stringify({ disabled: false }),
    },
  ]);
});
