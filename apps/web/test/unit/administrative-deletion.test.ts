import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { en } from '../../src/i18n/en.ts';
import { de } from '../../src/i18n/de.ts';
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
test('destructive UI requires scope review, preservation checkbox and exact target before sending DELETE', async (): Promise<void> => {
  const require: ReturnType<typeof createRequire> = createRequire(import.meta.url);
  const values: unknown[] = [];
  let cursor: number = 0;
  let deleted: boolean = false;
  const scope: object = {
    recipeCount: 1,
    revisionCount: 2,
    shareCount: 3,
    mediaCount: 4,
    memberCount: 5,
  };
  const calls: { path: string; options: RequestInit }[] = [];
  const compiled: string = ts.transpileModule(
    readFileSync(
      new URL('../../src/features/admin/safety/DeletionControl.tsx', import.meta.url),
      'utf8',
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  const module: { exports: { default?: (props: object) => Node } } = { exports: {} };
  const load: (id: string) => unknown = (id: string): unknown => {
    if (id === 'react')
      return {
        useState(initial: unknown): [unknown, (next: unknown) => void] {
          const slot: number = cursor++;
          if (!(slot in values)) values[slot] = initial;
          return [
            values[slot],
            (next: unknown): void => {
              values[slot] = next;
            },
          ];
        },
      };
    if (id === 'react/jsx-runtime') return require(id);
    if (id.endsWith('/MessageDialog')) return { default: 'Dialog' };
    if (id.endsWith('/api/client'))
      return {
        jsonRequest: (body: object): object => ({ body: JSON.stringify(body) }),
        request: async (path: string, options: RequestInit): Promise<object> => {
          calls.push({ path, options });
          return scope;
        },
      };
    return { safetyMessage: (): string => 'Failure' };
  };
  new Function('require', 'module', 'exports', compiled)(load, module, module.exports);
  const render: () => Node = (): Node => {
    cursor = 0;
    return module.exports.default!({
      tenantId: 'cookbook-uuid',
      relatedReportPublicId: '00000000-0000-4000-8000-000000000001',
      name: 'Private cookbook',
      text: en,
      onDeleted: (): void => {
        deleted = true;
      },
    });
  };
  const settle: () => Promise<void> = async (): Promise<void> =>
    new Promise<void>((resolve): void => setImmediate(resolve));
  let tree: Node = render();
  (
    nodes(tree).find((node: Node): boolean => node.type === 'button')!.props.onClick as () => void
  )();
  tree = render();
  (
    nodes(tree).find((node: Node): boolean => node.type === 'Dialog')!.props.onConfirm as () => void
  )();
  await settle();
  tree = render();
  assert.equal(calls.length, 0);
  assert.equal(
    nodes(tree).find((node: Node): boolean => node.props.role === 'alert')!.props.children,
    en.safety.invalidAdministrativeReason,
  );
  (
    nodes(tree).find((node: Node): boolean => node.type === 'textarea')!.props.onChange as (
      event: object,
    ) => void
  )({ currentTarget: { value: 'Verified no preservation requirement' } });
  (
    nodes(tree).filter((node: Node): boolean => node.type === 'textarea')[1]!.props.onChange as (
      event: object,
    ) => void
  )({ currentTarget: { value: '  Removed after review.  ' } });
  tree = render();
  (
    nodes(tree).find((node: Node): boolean => node.type === 'Dialog')!.props.onConfirm as () => void
  )();
  await settle();
  tree = render();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].path.endsWith('deletion-preview'));
  assert.equal('userReason' in JSON.parse(String(calls[0].options.body)), false);
  assert.equal(deleted, false);
  assert.equal(
    JSON.parse(String(calls[0].options.body)).relatedReportPublicId,
    '00000000-0000-4000-8000-000000000001',
  );
  const confirmationInput: Node = nodes(tree).find(
    (node: Node): boolean => node.type === 'input' && node.props.type !== 'checkbox',
  )!;
  (confirmationInput.props.onChange as (event: object) => void)({
    currentTarget: { value: 'cookbook-uuid' },
  });
  tree = render();
  (
    nodes(tree).find((node: Node): boolean => node.type === 'Dialog')!.props.onConfirm as () => void
  )();
  await settle();
  tree = render();
  assert.equal(calls.length, 1);
  assert.equal(
    nodes(tree).find((node: Node): boolean => node.props.role === 'alert')!.props.children,
    en.safety.preservationRequired,
  );
  const checkbox: Node = nodes(tree).find(
    (node: Node): boolean => node.type === 'input' && node.props.type === 'checkbox',
  )!;
  (checkbox.props.onChange as (event: object) => void)({ currentTarget: { checked: true } });
  const input: Node = nodes(tree).find(
    (node: Node): boolean => node.type === 'input' && node.props.type !== 'checkbox',
  )!;
  (input.props.onChange as (event: object) => void)({ currentTarget: { value: 'wrong-uuid' } });
  tree = render();
  (
    nodes(tree).find((node: Node): boolean => node.type === 'Dialog')!.props.onConfirm as () => void
  )();
  await settle();
  tree = render();
  assert.equal(calls.length, 1);
  assert.equal(
    nodes(tree).find((node: Node): boolean => node.props.role === 'alert')!.props.children,
    en.safety.invalidConfirmation,
  );
  (input.props.onChange as (event: object) => void)({ currentTarget: { value: 'cookbook-uuid' } });
  tree = render();
  (
    nodes(tree).find((node: Node): boolean => node.type === 'Dialog')!.props.onConfirm as () => void
  )();
  await settle();
  assert.equal(deleted, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, 'DELETE');
  assert.deepEqual(JSON.parse(String(calls[1].options.body)), {
    reason: 'Verified no preservation requirement',
    userReason: 'Removed after review.',
    relatedReportPublicId: '00000000-0000-4000-8000-000000000001',
    confirmation: 'cookbook-uuid',
    preservationReviewed: true,
    expectedScope: scope,
  });
});
test('safety controls have complete localized labels for both supported UI languages', (): void => {
  for (const locale of [en, de])
    for (const value of Object.values(locale.safety))
      assert.ok(typeof value === 'string' ? value.length > 0 : Object.keys(value).length === 5);
});
