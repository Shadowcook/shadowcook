import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const nativeDialogNames: ReadonlySet<string> = new Set<string>(['alert', 'confirm', 'prompt']);
const browserGlobals: ReadonlySet<string> = new Set<string>([
  'window',
  'globalThis',
  'self',
  'top',
  'parent',
]);
const sourceRoot: string = fileURLToPath(new URL('../../src', import.meta.url));

function nativeDialogReferences(source: string): string[] {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    'source.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const references: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && nativeDialogNames.has(node.text)) {
      const parent: ts.Node = node.parent;
      const isMemberName: boolean = ts.isPropertyAccessExpression(parent) && parent.name === node;
      const isPropertyName: boolean =
        (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node;
      if (
        (!isMemberName && !isPropertyName) ||
        (isMemberName &&
          ts.isIdentifier(parent.expression) &&
          browserGlobals.has(parent.expression.text))
      ) {
        references.push(node.text);
      }
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      browserGlobals.has(node.expression.text) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      nativeDialogNames.has(node.argumentExpression.text)
    ) {
      references.push(node.argumentExpression.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return references;
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path: string = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:astro|[cm]?[jt]sx?)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function scripts(path: string): string[] {
  const source: string = readFileSync(path, 'utf8');
  if (!path.endsWith('.astro')) return [source];
  const parts: string[] = [];
  const frontmatter: RegExpMatchArray | null = source.match(/^---\s*\n([\s\S]*?)\n---/);
  if (frontmatter !== null) parts.push(frontmatter[1]);
  for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) parts.push(match[1]);
  for (const match of source.matchAll(/\bon\w+\s*=\s*(["'])(.*?)\1/g)) parts.push(match[2]);
  return parts;
}

test('the native-dialog guard catches direct, qualified, optional, and aliased references', (): void => {
  const examples: string[] = [
    'alert("message")',
    'window.confirm("message")',
    'globalThis.prompt?.("message")',
    'self["alert"]("message")',
    'window[`confirm`]("message")',
    'const ask = window.confirm; ask("message")',
    'const { alert: show } = window; show("message")',
  ];
  for (const example of examples)
    assert.notEqual(nativeDialogReferences(example).length, 0, example);
  assert.deepEqual(
    nativeDialogReferences('const label = text.dialog.confirm; const role = "alert"; // alert()'),
    [],
  );
});

test('web application sources never reference browser-native alert, confirm, or prompt', (): void => {
  const violations: string[] = [];
  for (const path of sourceFiles(sourceRoot)) {
    for (const source of scripts(path)) {
      const references: string[] = nativeDialogReferences(source);
      if (references.length > 0)
        violations.push(`${relative(sourceRoot, path)}: ${references.join(', ')}`);
    }
  }
  assert.deepEqual(violations, [], 'Use the shared application MessageDialog component.');
});
