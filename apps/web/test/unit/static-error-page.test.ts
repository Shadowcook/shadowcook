import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { errorEnglish } from '../../src/i18n/errors.ts';

test('static outage page has localized default copy and no runtime dependencies', (): void => {
  const html: string = readFileSync(
    new URL('../../../../deployments/package/errors/50x.html', import.meta.url),
    'utf8',
  );
  assert.ok(html.includes(errorEnglish.service.title));
  assert.ok(html.includes(errorEnglish.service.description));
  assert.ok(html.includes(errorEnglish.home));
  assert.match(html, /href="\/"/);
  assert.doesNotMatch(html, /<script|<link|<img|@import|url\(|https?:\/\//i);
});
