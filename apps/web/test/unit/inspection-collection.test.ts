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
  const node: Node = tree as Node;
  return [node, ...[node.props.children].flat(Infinity).flatMap(nodes)];
}

test('inspection collections fetch bounded pages, debounce search, cancel stale responses and reset pages', async (): Promise<void> => {
  const values: unknown[] = [];
  const dependencies: unknown[][] = [];
  const cleanups: Record<number, (() => void) | void> = {};
  const effects: (() => void)[] = [];
  let cursor: number = 0;
  const calls: {
    body: Record<string, unknown>;
    signal: AbortSignal;
    resolve: (value: object) => void;
  }[] = [];
  const require: ReturnType<typeof createRequire> = createRequire(import.meta.url);
  const compiled: string = ts.transpileModule(
    readFileSync(
      new URL('../../src/features/admin/inspection/InspectionCollection.tsx', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    },
  ).outputText;
  const module: { exports: { default?: (props: object) => Node } } = { exports: {} };
  const load: (id: string) => unknown = (id: string): unknown => {
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'react')
      return {
        useState(initial: unknown): [unknown, (value: unknown) => void] {
          const slot: number = cursor++;
          if (!(slot in values)) values[slot] = initial;
          return [
            values[slot],
            (value: unknown): void => {
              values[slot] = value;
            },
          ];
        },
        useEffect(effect: () => (() => void) | void, next: unknown[]): void {
          const slot: number = cursor++;
          if (
            !dependencies[slot] ||
            next.some(
              (value: unknown, index: number): boolean => value !== dependencies[slot][index],
            )
          )
            effects.push((): void => {
              cleanups[slot]?.();
              cleanups[slot] = effect();
            });
          dependencies[slot] = next;
        },
      };
    if (id.endsWith('/api/client'))
      return {
        jsonRequest: (body: object): object => ({ body }),
        request: (
          _path: string,
          options: { body: Record<string, unknown>; signal: AbortSignal },
        ): Promise<object> =>
          new Promise<object>((resolve): void => {
            calls.push({ ...options, resolve });
          }),
      };
    throw new Error(id);
  };
  new Function('require', 'module', 'exports', compiled)(load, module, module.exports);
  const purpose: object = { reason: 'Investigate' };
  const render: () => Node = (): Node => {
    cursor = 0;
    const tree: Node = module.exports.default!({
      endpoint: '/inspection/members',
      purpose,
      text: en,
      title: 'Members',
      empty: 'Empty',
      children: (): null => null,
    });
    effects.splice(0).forEach((effect: () => void): void => effect());
    return tree;
  };
  const wait: (ms: number) => Promise<void> = (ms: number): Promise<void> =>
    new Promise<void>((resolve): void => {
      setTimeout(resolve, ms);
    });
  const resolve: (index: number, total?: number) => Promise<void> = async (
    index: number,
    total: number = 2000,
  ): Promise<void> => {
    calls[index].resolve({ items: [], total, page: calls[index].body.page, pageSize: 25 });
    await wait(0);
  };
  try {
    render();
    await wait(5);
    assert.deepEqual(calls[0].body, { reason: 'Investigate', query: '', page: 1, pageSize: 25 });
    await resolve(0);
    let tree: Node = render();
    const next: Node = nodes(tree).find(
      (node: Node): boolean => node.type === 'button' && node.props.children === en.inspection.next,
    )!;
    (next.props.onClick as () => void)();
    render();
    await wait(5);
    assert.equal(calls[1].body.page, 2);
    await resolve(1);
    tree = render();
    const search: Node = nodes(tree).find((node: Node): boolean => node.type === 'input')!;
    (search.props.onChange as (event: object) => void)({ currentTarget: { value: 'Ali' } });
    render();
    await wait(50);
    assert.equal(calls.length, 2);
    await wait(300);
    assert.equal(calls[2].body.query, 'Ali');
    assert.equal(calls[2].body.page, 1);
    tree = render();
    (
      nodes(tree).find((node: Node): boolean => node.type === 'input')!.props.onChange as (
        event: object,
      ) => void
    )({ currentTarget: { value: 'Alice' } });
    render();
    assert.equal(calls[2].signal.aborted, true);
    await wait(350);
    await resolve(3, 1);
    await resolve(2, 999);
    tree = render();
    const result: Node = nodes(tree).find(
      (node: Node): boolean => node.type === 'p' && node.props.role === 'status',
    )!;
    assert.ok([result.props.children].flat().includes(1));
    assert.ok(![result.props.children].flat().includes(999));
  } finally {
    Object.values(cleanups).forEach((cleanup: (() => void) | void): void => cleanup?.());
  }
});
