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
    ...[node.props.children].flat(Infinity).flatMap((item: unknown): Node[] => nodes(item)),
  ];
}
test('ownership transfer requires an unambiguous account, reason and distinct application confirmation', async (): Promise<void> => {
  const values: unknown[] = [];
  let cursor: number = 0;
  const dependencies: unknown[][] = [];
  const cleanups: Record<number, (() => void) | void> = {};
  const pending: (() => void)[] = [];
  const purpose: object = { reason: 'Inspect', relatedReportPublicId: 'ticket' };
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let completed: boolean = false;
  const require: ReturnType<typeof createRequire> = createRequire(import.meta.url);
  const source: string = readFileSync(
    new URL('../../src/features/admin/ownership/OwnershipTransfer.tsx', import.meta.url),
    'utf8',
  );
  const compiled: string = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module: { exports: { default?: (props: object) => Node } } = { exports: {} };
  const load: (id: string) => unknown = (id: string): unknown => {
    if (id === 'react')
      return {
        useEffect(effect: () => (() => void) | void, next: unknown[]): void {
          const slot: number = cursor++;
          if (
            !dependencies[slot] ||
            next.some(
              (value: unknown, index: number): boolean => value !== dependencies[slot][index],
            )
          )
            pending.push((): void => {
              cleanups[slot]?.();
              cleanups[slot] = effect();
            });
          dependencies[slot] = next;
        },
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
    if (id.endsWith('/api/client'))
      return {
        jsonRequest: (body: object): object => ({ body: JSON.stringify(body) }),
        request: async (path: string, options: RequestInit): Promise<object> => {
          calls.push({ path, body: JSON.parse(String(options.body)) });
          return path.endsWith('ownership-candidates')
            ? {
                users: [
                  {
                    publicId: 'recipient-one',
                    displayName: 'Same name',
                    email: 'one@example.test',
                  },
                  {
                    publicId: 'recipient-two',
                    displayName: 'Same name',
                    email: 'two@example.test',
                  },
                ],
              }
            : {
                oldOwnerPublicId: 'old-owner',
                newOwnerPublicId: 'recipient-two',
                notifications: [
                  { recipient: 'OLD_OWNER', status: 'FAILED' },
                  { recipient: 'NEW_OWNER', status: 'SENT' },
                ],
              };
        },
      };
    throw new Error(`Unexpected import ${id}`);
  };
  new Function('require', 'module', 'exports', compiled)(load, module, module.exports);
  const render: () => Node = (): Node => {
    cursor = 0;
    const tree: Node = module.exports.default!({
      cookbook: {
        public_id: 'cookbook',
        owner_public_id: 'old-owner',
        owner_name: 'Previous owner',
        display_name: 'Cookbook',
      },
      purpose,
      text: en,
      onTransferred: (): void => {
        completed = true;
      },
    });
    for (const effect of pending.splice(0)) effect();
    return tree;
  };
  const change: (node: Node, value: string) => void = (node: Node, value: string): void =>
    (node.props.onChange as (event: object) => void)({ currentTarget: { value } });
  const submit: (node: Node) => Promise<void> = async (node: Node): Promise<void> => {
    await (node.props.onSubmit as (event: object) => Promise<void>)({ preventDefault(): void {} });
  };
  let tree: Node = render();
  change(
    nodes(tree).find((node: Node): boolean => node.type === 'input')!,
    'Same name',
  );
  tree = render();
  assert.equal(calls.length, 0);
  await new Promise<void>((resolve): void => {
    setTimeout(resolve, 350);
  });
  tree = render();
  assert.equal(calls.length, 1);
  const candidates: Node[] = nodes(tree).filter(
    (node: Node): boolean => node.type === 'button' && node.props['aria-pressed'] !== undefined,
  );
  assert.equal(candidates.length, 2);
  assert.ok(
    nodes(candidates[1]).some((node: Node): boolean => node.props.children === 'two@example.test'),
  );
  (candidates[1].props.onClick as () => void)();
  const selectors: Node[] = nodes(tree).filter((node: Node): boolean => node.type === 'select');
  change(selectors[0]!, 'Editor');
  change(
    nodes(tree).find((node: Node): boolean => node.type === 'textarea')!,
    'Verified recovery claim',
  );
  tree = render();
  await submit(nodes(tree).filter((node: Node): boolean => node.type === 'form')[0]!);
  tree = render();
  assert.equal(calls.length, 1);
  assert.equal(completed, false);
  const dialog: Node = nodes(tree).find((node: Node): boolean => node.type === 'MessageDialog')!;
  assert.equal(dialog.props.kind, 'confirmation');
  (dialog.props.onConfirm as () => void)();
  await new Promise<void>((resolve): void => setImmediate(resolve));
  assert.equal(completed, true);
  assert.deepEqual(calls[1], {
    path: '/admin/tenants/cookbook/ownership-transfer',
    body: {
      reason: 'Verified recovery claim',
      relatedReportPublicId: 'ticket',
      recipientPublicId: 'recipient-two',
      expectedOwnerPublicId: 'old-owner',
      formerOwnerRole: 'Editor',
      confirmed: true,
    },
  });
  for (const cleanup of Object.values(cleanups)) cleanup?.();
});
test('ownership labels and mail-template titles exist in both UI locales', (): void => {
  for (const locale of [en, de]) {
    for (const text of Object.values(locale.ownership)) assert.ok(text.length > 0);
    assert.ok(locale.emailTemplates.templateNames.COOKBOOK_OWNERSHIP_TRANSFERRED);
  }
});
