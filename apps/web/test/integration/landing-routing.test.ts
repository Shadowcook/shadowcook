import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  createServer,
  type Server,
  type RequestListener,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CookbookResponse, RecipeDetail } from '../../src/features/cookbook/model/types.ts';
import { pdfRecipeFixture } from '../fixtures/pdf-recipe.ts';

const recipe: RecipeDetail = pdfRecipeFixture();
const cookbook: CookbookResponse = {
  tenant: { public_id: 'family', display_name: 'Family recipes', frontpage_heading: null },
  categories: [
    { public_id: 'baking', parent_public_id: null, name: 'Baking', slug: 'baking', sort_order: 0 },
    { public_id: 'cakes', parent_public_id: 'baking', name: 'Cakes', slug: 'cakes', sort_order: 0 },
  ],
  recipes: [{ ...recipe, category_public_ids: ['cakes'] }],
  frontpage: { recipes: [], page: 1, pageSize: 4, totalPages: 0, totalRecipes: 0 },
  canManageCategories: false,
  canManageRecipes: false,
  canCreateRecipes: false,
  canManageUsers: false,
  canManageIngredients: false,
  canManageUnits: false,
  canManageServiceAccounts: false,
  canCreateAiContexts: false,
};
const requests: string[] = [];
let api: Server;
let web: Server;
let origin: string;
const previousOrigin: string | undefined = process.env.SHADOWCOOK_API_ORIGIN;
const previousAutostart: string | undefined = process.env.ASTRO_NODE_AUTOSTART;

before(async (): Promise<void> => {
  api = createServer((request: IncomingMessage, response: ServerResponse): void => {
    const path: string = request.url ?? '';
    requests.push(path);
    response.setHeader('content-type', 'application/json');
    if (path === '/auth/session' && request.headers.cookie?.includes('session=test')) {
      response.end(JSON.stringify({ email: 'member@example.test', displayName: 'Member' }));
    } else if (path.startsWith('/cookbook?tenantSlug=family')) {
      response.end(JSON.stringify(cookbook));
    } else if (path.startsWith(`/cookbook/recipes/${recipe.public_id}`)) {
      response.end(JSON.stringify(recipe));
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  process.env.SHADOWCOOK_API_ORIGIN = await listen(api);
  process.env.ASTRO_NODE_AUTOSTART = 'disabled';
  const entry: { handler: RequestListener } = await import(
    new URL('../../dist/server/entry.mjs', import.meta.url).href
  );
  web = createServer(entry.handler);
  origin = await listen(web);
});
after(async (): Promise<void> => {
  await Promise.all([close(web), close(api)]);
  if (previousOrigin === undefined) delete process.env.SHADOWCOOK_API_ORIGIN;
  else process.env.SHADOWCOOK_API_ORIGIN = previousOrigin;
  if (previousAutostart === undefined) delete process.env.ASTRO_NODE_AUTOSTART;
  else process.env.ASTRO_NODE_AUTOSTART = previousAutostart;
});

test('root has localized server-rendered marketing and real recipe steps with and without a session', async (): Promise<void> => {
  for (const [locale, headline] of [
    ['en', 'Your recipes. Your cookbook. Your kitchen.'],
    ['de', 'Deine Rezepte. Dein Kochbuch. Deine Küche.'],
  ]) {
    for (const session of ['', '; session=test']) {
      requests.length = 0;
      const response: Response = await fetch(`${origin}/?tracking=example`, {
        headers: { cookie: `shadowcook_locale=${locale}${session}` },
      });
      const html: string = await response.text();
      assert.equal(response.status, 200);
      assert.ok(html.includes(headline));
      assert.match(html, /class="recipe-steps"/);
      assert.match(html, /Cook the pasta in salted water/);
      assert.match(html, /href="\/explore"/);
      assert.match(html, /href="\/register"/);
      assert.doesNotMatch(html, /tenant-selection|tracking=example/);
      assert.equal(
        requests.some((path: string): boolean => path.startsWith('/cookbook')),
        false,
      );
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
  }
});

test('Explore owns the existing selection and never fetches a cookbook named explore', async (): Promise<void> => {
  requests.length = 0;
  const response: Response = await fetch(`${origin}/explore`);
  const html: string = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /tenant-selection/);
  assert.doesNotMatch(html, /landing-hero/);
  assert.match(html, /aria-current="page"/);
  assert.equal(
    requests.some((path: string): boolean => path.startsWith('/cookbook?')),
    false,
  );
});

test('short cookbook, nested category, recipe and variant URLs retain server-rendered content on repeated requests', async (): Promise<void> => {
  for (const path of [
    '/family',
    '/family/baking/cakes',
    `/family/recipes/${recipe.slug}`,
    `/family/baking/cakes/recipes/${recipe.slug}/ohne-zucker`,
  ]) {
    for (let reload: number = 0; reload < 2; reload += 1) {
      const response: Response = await fetch(`${origin}${path}`);
      const html: string = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, /Family recipes/);
      if (path.includes('/recipes/')) {
        assert.match(html, /application\/ld\+json/);
        assert.match(html, /recipe-steps/);
        assert.ok(html.includes(recipe.title));
      }
    }
  }
});

test('system pages retain their routes without tenant lookups', async (): Promise<void> => {
  for (const path of [
    '/login',
    '/register',
    '/settings',
    '/admin',
    '/privacy-statement',
    '/imprint',
  ]) {
    requests.length = 0;
    const response: Response = await fetch(`${origin}${path}`, { redirect: 'manual' });
    assert.ok([200, 302].includes(response.status), path);
    assert.equal(
      requests.some((request: string): boolean => request.startsWith('/cookbook?')),
      false,
      path,
    );
  }
});

test('missing cookbooks and category paths return a useful server-rendered 404', async (): Promise<void> => {
  for (const path of [
    '/missing-cookbook',
    '/family/missing-category',
    '/family/baking/cakes/recipes/missing',
  ]) {
    const response: Response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 404, path);
    assert.match(await response.text(), /href="\/explore"/);
  }
});

async function listen(server: Server): Promise<string> {
  return new Promise<string>((resolve: (value: string) => void): void => {
    server.listen(0, '127.0.0.1', (): void => {
      const address: AddressInfo = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}
async function close(server: Server): Promise<void> {
  if (server === undefined) return;
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => resolve());
    server.closeAllConnections();
  });
}
