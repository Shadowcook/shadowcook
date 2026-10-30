import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCookbookSlug, reservedCookbookSlugs } from '../../src/cookbook/slug-policy.js';

test('the public MCP namespace cannot be assigned to a cookbook', (): void => {
  assert.equal(reservedCookbookSlugs.has('mcp'), true);
});

test('Explore is a reserved cookbook slug', (): void => {
  assert.equal(reservedCookbookSlugs.has('explore'), true);
});

test('the landing namespace is reserved without reserving prefixed cookbook names', (): void => {
  assert.equal(reservedCookbookSlugs.has('landing'), true);
  assert.equal(reservedCookbookSlugs.has('landing-kitchen'), false);
});

test('fixed public system routes cannot be assigned to cookbooks', (): void => {
  const paths: readonly string[] = [
    '/admin/settings',
    '/api/cookbook/tenants',
    '/assets/landing/styles.css',
    '/auth',
    '/explore',
    '/health',
    '/imprint',
    '/invitations/token',
    '/landing/contact',
    '/login',
    '/logout',
    '/mcp',
    '/password-reset/token',
    '/privacy-statement',
    '/register',
    '/settings/profile',
    '/shared/recipes/token',
    '/user-invitations/token',
    '/verify-email/token',
  ];
  for (const path of paths) {
    const slug: string = path.split('/')[1]!;
    assert.equal(reservedCookbookSlugs.has(slug), true, path);
    assert.equal(reservedCookbookSlugs.has(`${slug}-kitchen`), false, path);
  }
});

test('framework namespaces and public asset filenames are excluded by slug syntax', (): void => {
  for (const segment of [
    '.well-known',
    '_astro',
    '_image',
    '_server-islands',
    '_actions',
    'favicon.png',
    'shadowcook-logo.png',
  ]) {
    assert.equal(normalizeCookbookSlug(segment), null, segment);
  }
});
