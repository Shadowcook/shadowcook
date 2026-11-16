import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { en } from '../../src/i18n/en.ts';
import { de } from '../../src/i18n/de.ts';
import { reportLink, reportReferenceFromUrl } from '../../src/features/admin/reports/links.ts';
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
const reportId: string = '00000000-0000-4000-8000-000000000001';
const accountId: string = '00000000-0000-4000-8000-000000000002';

test('report action deep links preserve only validated report IDs and bind account actions to the exact user', (): void => {
  const original: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(
    globalThis,
    'window',
  );
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { search: `?report=${reportId}&user=${accountId}&reason=never-retain-this` },
      },
    });
    assert.equal(reportReferenceFromUrl(), reportId);
    assert.equal(reportReferenceFromUrl(accountId), reportId);
    assert.equal(reportReferenceFromUrl(reportId), '');
    assert.equal(
      reportLink(`/admin/users#user-${accountId}`, reportId),
      `/admin/users?report=${reportId}&user=${accountId}#user-${accountId}`,
    );
    assert.equal(
      reportLink('/admin/tenants/book/inspection', reportId),
      `/admin/tenants/book/inspection?report=${reportId}`,
    );
    assert.equal(
      reportLink('/admin/tenants/book/inspection', 'javascript:bad'),
      '/admin/tenants/book/inspection',
    );
    assert.equal(isKnownSystemPage(`/admin/reports/${reportId}`), true);
    assert.equal(isKnownSystemPage('/admin/reports/not-a-uuid/unrelated'), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('a public notice requires recipient, separate public explanation and review instructions before confirmed send', async (): Promise<void> => {
  const require: ReturnType<typeof createRequire> = createRequire(import.meta.url);
  const values: unknown[] = [];
  let cursor: number = 0;
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const compiled: string = ts.transpileModule(
    readFileSync(
      new URL('../../src/features/admin/reports/ReportNotice.tsx', import.meta.url),
      'utf8',
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  const module: { exports: { default?: (props: object) => Node } } = { exports: {} };
  const load: (id: string) => unknown = (id: string): unknown => {
    if (id === 'react')
      return {
        useState(initial: unknown): [unknown, (next: unknown) => void] {
          const index: number = cursor++;
          if (!(index in values)) values[index] = initial;
          return [
            values[index],
            (next: unknown): void => {
              values[index] = next;
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
          calls.push({ path, body: JSON.parse(String(options.body)) });
          return { noticePublicId: accountId, deliveryStatus: 'FAILED' };
        },
      };
    throw new Error(`Unexpected test import ${id}`);
  };
  new Function('require', 'module', 'exports', compiled)(load, module, module.exports);
  const render: () => Node = (): Node => {
    cursor = 0;
    return module.exports.default!({
      reportId,
      context: { recipients: [{ role: 'TARGET', publicId: accountId, displayName: 'Recipient' }] },
      text: en,
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
  assert.equal(calls.length, 0);
  tree = render();
  (
    nodes(tree).find((node: Node): boolean => node.type === 'select')!.props.onChange as (
      event: object,
    ) => void
  )({ currentTarget: { value: 'TARGET' } });
  const fields: Node[] = nodes(tree).filter((node: Node): boolean => node.type === 'textarea');
  const input: string[] = [
    'Private verification rationale',
    'Public outcome without investigator notes',
    'Request review at support@example.test',
  ];
  for (let index: number = 0; index < fields.length; index++)
    (fields[index].props.onChange as (event: object) => void)({
      currentTarget: { value: input[index] },
    });
  tree = render();
  assert.equal(
    nodes(tree).find((node: Node): boolean => node.type === 'Dialog')!.props.message,
    en.workflow.noticeConfirmation,
  );
  (
    nodes(tree).find((node: Node): boolean => node.type === 'Dialog')!.props.onConfirm as () => void
  )();
  await settle();
  tree = render();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/admin/reports/${reportId}/notices`);
  assert.deepEqual(calls[0].body, {
    reason: input[0],
    confirmed: true,
    recipientRole: 'TARGET',
    expectedRecipientPublicId: accountId,
    message: input[1],
    reviewInstructions: input[2],
  });
  assert.ok(
    nodes(tree).some(
      (node: Node): boolean =>
        node.props.role === 'status' && node.props.children === en.workflow.noticeFailed,
    ),
  );
});

test('report workflow labels, action descriptions and delivery outcomes are localized in both languages', (): void => {
  for (const text of [en, de])
    for (const value of Object.values(text.workflow)) {
      if (typeof value === 'string') assert.ok(value.length > 0);
      else
        assert.ok(
          Object.values(value).every(
            (label: unknown): boolean => typeof label === 'string' && label.length > 0,
          ),
        );
    }
  assert.deepEqual(Object.keys(en.workflow.actions), Object.keys(de.workflow.actions));
});
