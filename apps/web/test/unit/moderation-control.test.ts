import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { en } from '../../src/i18n/en.ts';
interface Node {
  type: unknown;
  props: Record<string, unknown>;
}
function nodes(tree: unknown): Node[] {
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
  const item: Node = tree as Node;
  return [
    item,
    ...[item.props.children].flat(Infinity).flatMap((child: unknown): Node[] => nodes(child)),
  ];
}
test('moderation requires its project confirmation and reason before a scoped request', async (): Promise<void> => {
  const require: ReturnType<typeof createRequire> = createRequire(import.meta.url);
  const values: unknown[] = [];
  let cursor: number = 0;
  let saved: boolean = false;
  let restricted: boolean = false;
  const writes: { path: string; options: RequestInit }[] = [];
  const compiled: string = ts.transpileModule(
    readFileSync(
      new URL('../../src/features/admin/moderation/ModerationControl.tsx', import.meta.url),
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
    if (id.endsWith('/MessageDialog')) return { default: 'MessageDialog' };
    return {
      request: async (path: string, options: RequestInit): Promise<void> => {
        writes.push({ path, options });
      },
    };
  };
  new Function('require', 'module', 'exports', compiled)(load, module, module.exports);
  const render: () => Node = (): Node => {
    cursor = 0;
    return module.exports.default!({
      tenantId: 'tenant',
      recipeId: 'recipe',
      blocked: restricted,
      name: 'Private recipe',
      text: en,
      onSaved: (): void => {
        saved = true;
      },
    });
  };
  let tree: Node = render();
  (
    nodes(tree).find((node: Node): boolean => node.type === 'button')!.props.onClick as () => void
  )();
  tree = render();
  let dialog: Node = nodes(tree).find((node: Node): boolean => node.type === 'MessageDialog')!;
  assert.equal(dialog.props.kind, 'confirmation');
  (dialog.props.onConfirm as () => void)();
  await new Promise<void>((resolve): void => setImmediate(resolve));
  assert.equal(writes.length, 0);
  tree = render();
  (
    nodes(tree).find((node: Node): boolean => node.type === 'textarea')!.props.onChange as (
      event: object,
    ) => void
  )({ currentTarget: { value: 'Reviewed report' } });
  tree = render();
  dialog = nodes(tree).find((node: Node): boolean => node.type === 'MessageDialog')!;
  (dialog.props.onConfirm as () => void)();
  await new Promise<void>((resolve): void => setImmediate(resolve));
  assert.equal(writes.length, 0);
  tree = render();
  (
    nodes(tree).filter((node: Node): boolean => node.type === 'textarea')[1]!.props.onChange as (
      event: object,
    ) => void
  )({ currentTarget: { value: '  Please remove advertising.  ' } });
  tree = render();
  dialog = nodes(tree).find((node: Node): boolean => node.type === 'MessageDialog')!;
  (dialog.props.onConfirm as () => void)();
  await new Promise<void>((resolve): void => setImmediate(resolve));
  assert.equal(saved, true);
  assert.equal(writes[0].path, '/admin/tenants/tenant/recipes/recipe/moderation');
  assert.equal(writes[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(String(writes[0].options.body)), {
    blocked: true,
    confirmed: true,
    reason: 'Reviewed report',
    userReason: 'Please remove advertising.',
  });
  restricted = true;
  tree = render();
  (
    nodes(tree).find((node: Node): boolean => node.type === 'button')!.props.onClick as () => void
  )();
  tree = render();
  const fields: Node[] = nodes(tree).filter((node: Node): boolean => node.type === 'textarea');
  assert.equal(fields[1]!.props['aria-required'], false);
  assert.equal(fields[1]!.props.value, '');
  (fields[0]!.props.onChange as (event: object) => void)({
    currentTarget: { value: 'Review completed' },
  });
  tree = render();
  dialog = nodes(tree).find((node: Node): boolean => node.type === 'MessageDialog')!;
  (dialog.props.onConfirm as () => void)();
  await new Promise<void>((resolve): void => setImmediate(resolve));
  assert.equal(writes.length, 2);
  assert.deepEqual(JSON.parse(String(writes[1]!.options.body)), {
    blocked: false,
    confirmed: true,
    reason: 'Review completed',
  });
});
