import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { en } from '../../src/i18n/en.ts';
import { cookbookSlugBase, isValidCookbookName } from '../../src/lib/cookbook-name.ts';

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

function harness(status: string): { render(): ElementNode; writes: object[] } {
  const values: unknown[] = [];
  const writes: object[] = [];
  let cursor: number = 0;
  const require: NodeJS.Require = createRequire(import.meta.url);
  const source: string = readFileSync(
    new URL('../../src/components/CookbookRenameModal.tsx', import.meta.url),
    'utf8',
  );
  const compiled: string = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const hooks: object = {
    useRef: (): object => ({ current: null }),
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
  };
  const module: { exports: any } = { exports: {} };
  const load: (id: string) => unknown = (id: string): unknown => {
    if (id === 'react') return hooks;
    if (id === 'react/jsx-runtime') return require(id);
    if (id.endsWith('/cookbook-name')) return { cookbookSlugBase, isValidCookbookName };
    if (id.endsWith('/use-tenant-slug-availability'))
      return { useTenantSlugAvailability: (): string => status };
    if (id === './CookbookUrlPreview') return { CookbookSlugPreview: 'preview' };
    if (id.endsWith('/api/client'))
      return {
        request: async (_path: string, options: RequestInit): Promise<void> => {
          writes.push(JSON.parse(String(options.body)));
        },
        jsonRequest: (body: object): RequestInit => ({ body: JSON.stringify(body) }),
      };
    return { default: id };
  };
  new Function('require', 'module', 'exports', compiled)(load, module, module.exports);
  return {
    writes,
    render(): ElementNode {
      cursor = 0;
      return module.exports.default({
        cookbook: { publicId: 'cookbook-id', name: 'Old kitchen', slug: 'old-kitchen' },
        text: en,
        required: true,
        onClose: (): void => {},
        onSaved: (): void => {},
      });
    },
  };
}

test('forced reset derives a slug from the name and shows the shared suffix preview on collision', async (): Promise<void> => {
  const editor: ReturnType<typeof harness> = harness('collision');
  nodes(editor.render(), 'input')[0].props.onChange({
    currentTarget: { value: '  Crème brûlée kitchen  ' },
  });
  const tree: ElementNode = editor.render();
  assert.equal(nodes(tree, 'input')[1].props.value, 'cre-me-bru-le-e-kitchen');
  assert.equal(nodes(tree, 'preview')[0].props.collision, true);
  assert.equal(nodes(tree, 'button')[0].props.disabled, false);
  await nodes(tree, 'form')[0].props.onSubmit({ preventDefault(): void {} });
  assert.deepEqual(editor.writes, [
    {
      displayName: '  Crème brûlée kitchen  ',
      slug: 'cre-me-bru-le-e-kitchen',
      appendSuffixOnConflict: true,
    },
  ]);
});

test('manual slug edits survive name changes and do not opt into automatic suffixes', async (): Promise<void> => {
  const editor: ReturnType<typeof harness> = harness('available');
  nodes(editor.render(), 'input')[0].props.onChange({ currentTarget: { value: 'New kitchen' } });
  nodes(editor.render(), 'input')[1].props.onChange({ currentTarget: { value: 'my-custom-url' } });
  nodes(editor.render(), 'input')[0].props.onChange({
    currentTarget: { value: 'Another kitchen' },
  });
  const tree: ElementNode = editor.render();
  assert.equal(nodes(tree, 'input')[1].props.value, 'my-custom-url');
  assert.equal(nodes(tree, 'preview')[0].props.collision, false);
  await nodes(tree, 'form')[0].props.onSubmit({ preventDefault(): void {} });
  assert.deepEqual(editor.writes, [
    { displayName: 'Another kitchen', slug: 'my-custom-url', appendSuffixOnConflict: false },
  ]);
});

test('blocked or invalid slugs cannot be submitted and never promise a suffix', (): void => {
  const editor: ReturnType<typeof harness> = harness('unavailable');
  nodes(editor.render(), 'input')[0].props.onChange({ currentTarget: { value: 'Admin' } });
  const tree: ElementNode = editor.render();
  assert.equal(nodes(tree, 'preview')[0].props.collision, false);
  assert.equal(nodes(tree, 'button')[0].props.disabled, true);
});
