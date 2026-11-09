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
async function harness(response: Response): Promise<{ render(): ElementNode; writes(): number }> {
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
    if (options?.method === 'PATCH') {
      writeCount++;
      return response;
    }
    return Response.json({
      tenants: [
        {
          public_id: 'tenant-id',
          display_name: 'My kitchen',
          slug: 'my-kitchen',
          disabled_at: null,
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
    (node: ElementNode): boolean => node.props['aria-label'] === en.dashboard.rename,
  );
  assert.ok(edit);
  edit.props.onClick();
  return { render, writes: (): number => writeCount };
}

test('an unavailable slug opens an error dialog only after Save and preserves entered values', async (): Promise<void> => {
  const editor: Awaited<ReturnType<typeof harness>> = await harness(
    Response.json({ code: 'TENANT_SLUG_CONFLICT' }, { status: 409 }),
  );
  const slugInput: ElementNode = nodes(editor.render(), 'input').find(
    (node: ElementNode): boolean => node.props.value === 'my-kitchen',
  )!;
  slugInput.props.onChange({ currentTarget: { value: 'occupied-kitchen' } });
  let tree: ElementNode = editor.render();
  assert.equal(nodes(tree, '../../../components/MessageDialog').length, 0);
  assert.equal(editor.writes(), 0);
  assert.ok(
    nodes(tree, 'p').some(
      (node: ElementNode): boolean => node.props.children === en.admin.tenantSlugInvalid,
    ),
  );
  nodes(tree, 'form')[0].props.onSubmit({ preventDefault(): void {} });
  await new Promise<void>((resolve): void => {
    setImmediate(resolve);
  });
  tree = editor.render();
  const dialog: ElementNode = nodes(tree, '../../../components/MessageDialog')[0];
  assert.equal(dialog.props.kind, 'error');
  assert.equal(dialog.props.message, en.admin.tenantSlugConflict);
  assert.equal(editor.writes(), 1);
  dialog.props.onClose();
  tree = editor.render();
  assert.equal(nodes(tree, '../../../components/MessageDialog').length, 0);
  assert.ok(
    nodes(tree, 'input').some(
      (node: ElementNode): boolean => node.props.value === 'occupied-kitchen',
    ),
  );
  assert.ok(
    nodes(tree, 'input').some((node: ElementNode): boolean => node.props.value === 'My kitchen'),
  );
});

test('reserved or blocked slugs show the localized save error in the project dialog', async (): Promise<void> => {
  const editor: Awaited<ReturnType<typeof harness>> = await harness(
    Response.json({ code: 'INVALID_TENANT_SLUG' }, { status: 400 }),
  );
  nodes(editor.render(), 'form')[0].props.onSubmit({ preventDefault(): void {} });
  await new Promise<void>((resolve): void => {
    setImmediate(resolve);
  });
  const dialog: ElementNode = nodes(editor.render(), '../../../components/MessageDialog')[0];
  assert.equal(dialog.props.message, en.admin.tenantSlugInvalid);
});
