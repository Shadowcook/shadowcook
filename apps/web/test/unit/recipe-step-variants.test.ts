import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import type { DraftVariant } from '../../src/features/cookbook/components/RecipeVariantsEditor';
import { en } from '../../src/i18n/en.ts';
import {
  refreshStepVariants,
  setStepVariant,
  stepVariantKeys,
} from '../../src/features/cookbook/model/step-variants.ts';

const defaultKey: string = '00000000-0000-4000-8000-000000000001';
const alternativeKey: string = '00000000-0000-4000-8000-000000000002';
function variant(key: string, isDefault: boolean, stepIds: string[] = []): DraftVariant {
  return {
    variantKey: key,
    name: key,
    slug: key,
    isDefault,
    isVisible: true,
    overrides: stepIds.map((stepId: string) => ({ stepId, state: 'INCLUDE' as const })),
  };
}

test('refresh retains unsaved inclusions and exclusions while adding and removing variants', (): void => {
  const current: DraftVariant[] = [
    variant(defaultKey, true, ['new']),
    variant(alternativeKey, false),
  ];
  const loaded: DraftVariant[] = [
    variant(defaultKey, true, ['existing']),
    variant(alternativeKey, false, ['new', 'existing']),
    variant('third', false),
  ];
  const refreshed: DraftVariant[] = refreshStepVariants(loaded, current, new Set(['new']));
  assert.deepEqual(stepVariantKeys(refreshed, 'new'), [defaultKey]);
  assert.deepEqual(stepVariantKeys(refreshed, 'existing'), [defaultKey, alternativeKey]);
  assert.equal(refreshed.length, 3);
  assert.equal(refreshStepVariants([loaded[0]], current, new Set(['new'])).length, 1);
  assert.deepEqual(stepVariantKeys(setStepVariant(refreshed, defaultKey, 'new', false), 'new'), []);
});

// Exercise the component's event handlers and effects without a browser or a running server.
interface ElementNode {
  type: unknown;
  props: Record<string, any>;
}
interface Harness {
  render(version?: number): ElementNode;
  settle(): Promise<void>;
}
function harness(request: (path: string, options?: RequestInit) => Promise<unknown>): Harness {
  const values: any[] = [];
  const dependencies: unknown[][] = [];
  const effects: Array<() => void> = [];
  let cursor: number = 0;
  const require = createRequire(import.meta.url);
  const hooks: object = {
    useState(initial: unknown): [unknown, (next: any) => void] {
      const slot: number = cursor++;
      if (!(slot in values)) values[slot] = initial;
      return [
        values[slot],
        (next: any): void => {
          values[slot] = typeof next === 'function' ? next(values[slot]) : next;
        },
      ];
    },
    useRef(initial: unknown): { current: unknown } {
      const slot: number = cursor++;
      if (!(slot in values)) values[slot] = { current: initial };
      return values[slot];
    },
    useEffect(effect: () => void, next: unknown[]): void {
      const slot: number = cursor++;
      if (
        !dependencies[slot] ||
        next.some((value: unknown, index: number): boolean => value !== dependencies[slot][index])
      )
        effects.push(effect);
      dependencies[slot] = next;
    },
  };
  const source: string = readFileSync(
    new URL('../../src/features/cookbook/components/RecipeStepsEditor.tsx', import.meta.url),
    'utf8',
  );
  const compiled: string = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module: { exports: any } = { exports: {} };
  const load = (id: string): unknown => {
    if (id === 'react') return hooks;
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'react-dom') return { createPortal: (node: unknown): unknown => node };
    if (id.endsWith('/api/client')) return { request };
    if (id.endsWith('/browser/uuid')) return { createBrowserUuid: (): string => 'new-step' };
    if (id.endsWith('/step-variants'))
      return { refreshStepVariants, setStepVariant, stepVariantKeys };
    return { default: id, recipeRequestError: (): string => 'request failed' };
  };
  new Function('require', 'module', 'exports', compiled)(load, module, module.exports);
  return {
    render(version: number = 0): ElementNode {
      cursor = 0;
      const tree: ElementNode = module.exports.default({
        tenantSlug: 'test',
        recipePublicId: 'recipe',
        text: en,
        variantsVersion: version,
        onDraftChanged: async (): Promise<void> => {},
        actionsContainer: {},
        isBusy: false,
        onBusyChanged: (): void => {},
      });
      for (const effect of effects.splice(0)) effect();
      return tree;
    },
    async settle(): Promise<void> {
      for (let index: number = 0; index < 4; index++)
        await new Promise<void>((resolve): void => {
          setImmediate(resolve);
        });
    },
  };
}
function nodes(tree: ElementNode, predicate: (node: ElementNode) => boolean): ElementNode[] {
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  const children: unknown[] = [tree.props.children].flat(Infinity);
  return [
    ...(predicate(tree) ? [tree] : []),
    ...children.flatMap((child): ElementNode[] => nodes(child as ElementNode, predicate)),
  ];
}
function checkboxes(tree: ElementNode): ElementNode[] {
  return nodes(tree, (node): boolean => node.type === 'input' && node.props.type === 'checkbox');
}

test('an already mounted steps editor shows newly created variants without losing unsaved instructions', async (): Promise<void> => {
  let variants: DraftVariant[] = [variant(defaultKey, true, ['step'])];
  let stepReads: number = 0;
  const editor: Harness = harness(async (path: string): Promise<unknown> => {
    if (path.endsWith('/variants')) return { variants };
    if (path.endsWith('/steps')) {
      stepReads++;
      return {
        steps: [
          {
            id: stepReads === 1 ? 'step' : 'draft-step',
            stepKey: 'stable-key',
            instruction: 'Original',
            ingredients: [],
          },
        ],
      };
    }
    return { units: [] };
  });
  editor.render();
  await editor.settle();
  let tree: ElementNode = editor.render();
  nodes(tree, (node): boolean => node.type === 'textarea')[0].props.onChange({
    currentTarget: { value: 'Unsaved edit', selectionStart: 12 },
  });
  variants = [variant(defaultKey, true, ['draft-step']), variant(alternativeKey, false)];
  editor.render(1);
  await editor.settle();
  tree = editor.render(1);
  assert.equal(checkboxes(tree).length, 2);
  assert.equal(
    nodes(tree, (node): boolean => node.type === 'textarea')[0].props.value,
    'Unsaved edit',
  );
  assert.equal(stepReads, 2);
  assert.deepEqual(
    checkboxes(tree).map((node): boolean => node.props.checked),
    [true, false],
  );
});

test('new step defaults to the default variant and saves alternate membership with its instruction', async (): Promise<void> => {
  let saved:
    | { steps: Array<{ id: string; instruction: string; includedVariantKeys: string[] }> }
    | undefined;
  let writes: number = 0;
  const editor: Harness = harness(async (path: string, options?: RequestInit): Promise<unknown> => {
    if (options?.method === 'PUT') {
      writes++;
      assert.ok(path.endsWith('/steps'));
      saved = JSON.parse(String(options.body));
      return;
    }
    if (path.endsWith('/variants'))
      return { variants: [variant(defaultKey, true), variant(alternativeKey, false)] };
    if (path.endsWith('/steps')) return { steps: [] };
    return { units: [] };
  });
  const originalWindow: unknown = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { requestAnimationFrame: (): void => {} },
  });
  try {
    editor.render();
    await editor.settle();
    let tree: ElementNode = editor.render();
    nodes(
      tree,
      (node): boolean => node.type === 'button' && node.props.children === en.recipeEditor.addStep,
    )[0].props.onClick();
    tree = editor.render();
    assert.deepEqual(
      checkboxes(tree).map((node): boolean => node.props.checked),
      [true, false],
    );
    checkboxes(tree)[0].props.onChange();
    tree = editor.render();
    checkboxes(tree)[1].props.onChange();
    tree = editor.render();
    assert.deepEqual(
      checkboxes(tree).map((node): boolean => node.props.checked),
      [false, true],
    );
    assert.equal(writes, 0);
    nodes(tree, (node): boolean => node.type === 'textarea')[0].props.onChange({
      currentTarget: { value: 'Cook', selectionStart: 4 },
    });
    tree = editor.render();
    nodes(
      tree,
      (node): boolean =>
        typeof node.type === 'string' && node.type.endsWith('RecipeEditorSaveButton'),
    )[0].props.onClick();
    await editor.settle();
    assert.equal(writes, 1);
    assert.deepEqual(saved?.steps[0].includedVariantKeys, [alternativeKey]);
    assert.equal(saved?.steps[0].instruction, 'Cook');
  } finally {
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});
