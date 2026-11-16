import { reportReferenceFromUrl, reportLink } from '../../src/features/admin/reports/links.ts';
import { formatInspectionAmount } from '../../src/features/admin/inspection/format.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { en } from '../../src/i18n/en.ts';
import { de } from '../../src/i18n/de.ts';
import { isKnownSystemPage } from '../../src/lib/system-routing.ts';

interface Node {
  type: unknown;
  props: Record<string, unknown>;
}
function nodes(tree: unknown): Node[] {
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
  const node: Node = tree as Node;
  return [
    node,
    ...[node.props.children].flat(Infinity).flatMap((child: unknown): Node[] => nodes(child)),
  ];
}

test('inspection prompts before sensitive fetching and clears the purpose on ending', async (): Promise<void> => {
  const require: ReturnType<typeof createRequire> = createRequire(import.meta.url);
  const values: unknown[] = [];
  const dependencies: unknown[][] = [];
  const cleanups: Record<number, (() => void) | void> = {};
  let cursor: number = 0;
  const pending: (() => void)[] = [];
  const calls: { path: string; body: unknown }[] = [];
  const originalWindow: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(
    globalThis,
    'window',
  );
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { search: '' },
      addEventListener(): void {},
      removeEventListener(): void {},
    },
  });
  const hooks: object = {
    useState(initial: unknown): [unknown, (next: unknown) => void] {
      const slot: number = cursor++;
      if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
      return [
        values[slot],
        (next: unknown): void => {
          values[slot] = next;
        },
      ];
    },
    useEffect(effect: () => (() => void) | void, next: unknown[]): void {
      const slot: number = cursor++;
      if (
        !dependencies[slot] ||
        next.some((value: unknown, index: number): boolean => value !== dependencies[slot][index])
      )
        pending.push((): void => {
          cleanups[slot]?.();
          cleanups[slot] = effect();
        });
      dependencies[slot] = next;
    },
  };
  const compiled: string = ts.transpileModule(
    readFileSync(
      new URL('../../src/features/admin/inspection/AdminInspection.tsx', import.meta.url),
      'utf8',
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  const module: { exports: { default?: (props: object) => Node } } = { exports: {} };
  const load: (id: string) => unknown = (id: string): unknown => {
    if (id === 'react') return hooks;
    if (id === 'react/jsx-runtime') return require(id);
    if (id.endsWith('/reports/links')) return { reportReferenceFromUrl, reportLink };
    if (id.endsWith('/i18n')) return { translations: { en, de } };
    if (id.endsWith('/api/client'))
      return {
        jsonRequest: (body: object): object => ({ body: JSON.stringify(body) }),
        request: async (path: string, options: RequestInit): Promise<object> => {
          calls.push({ path, body: JSON.parse(String(options.body)) });
          return {
            cookbook: {
              display_name: 'Private cookbook',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
            counts: { recipes: 0, members: 0, reports: 0 },
          };
        },
      };
    return { default: 'revision' };
  };
  new Function('require', 'module', 'exports', compiled)(load, module, module.exports);
  const render: () => Node = (): Node => {
    cursor = 0;
    const tree: Node = module.exports.default!({
      locale: 'en',
      path: '/admin/tenants/cookbook-id/inspection',
    });
    for (const effect of pending.splice(0)) effect();
    return tree;
  };
  try {
    let tree: Node = render();
    assert.equal(calls.length, 0);
    const reason: Node = nodes(tree).find((node: Node): boolean => node.type === 'textarea')!;
    (reason.props.onChange as (event: object) => void)({
      currentTarget: { value: 'Legitimate investigation' },
    });
    tree = render();
    const form: Node = nodes(tree).find((node: Node): boolean => node.type === 'form')!;
    (form.props.onSubmit as (event: object) => void)({ preventDefault(): void {} });
    render();
    await new Promise<void>((resolve): void => setImmediate(resolve));
    tree = render();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      path: '/admin/tenants/cookbook-id/inspection',
      body: { reason: 'Legitimate investigation' },
    });
    const end: Node = nodes(tree).find(
      (node: Node): boolean => node.type === 'button' && node.props.children === en.inspection.end,
    )!;
    (end.props.onClick as () => void)();
    render();
    tree = render();
    assert.equal(
      nodes(tree).find((node: Node): boolean => node.type === 'textarea')!.props.value,
      '',
    );
    assert.ok(
      !nodes(tree).some((node: Node): boolean => node.props.children === 'Private cookbook'),
    );
    assert.equal(calls.length, 1);
  } finally {
    for (const cleanup of Object.values(cleanups)) cleanup?.();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('inspection has localized labels and deep routes while arbitrary administration suffixes remain invalid', (): void => {
  for (const dictionary of [en, de])
    for (const value of Object.values(dictionary.inspection))
      assert.ok(typeof value === 'string' ? value.length > 0 : Object.keys(value).length > 0);
  assert.equal(isKnownSystemPage('/admin/tenants/tenant/inspection'), true);
  assert.equal(isKnownSystemPage('/admin/tenants/tenant/recipes/recipe/inspection'), true);
  assert.equal(isKnownSystemPage('/admin/tenants/tenant/recipes/recipe/revisions/revision'), true);
  assert.equal(isKnownSystemPage('/admin/tenants/tenant/unknown'), false);
});

test('inspection amounts preserve exact large decimals without trailing zeroes', (): void => {
  assert.equal(
    formatInspectionAmount('999999999999.123456789012', 'en'),
    '999999999999.123456789012',
  );
  assert.equal(formatInspectionAmount('1.230000000000', 'de'), '1,23');
  assert.equal(formatInspectionAmount('10.000000000000', 'en'), '10');
});
