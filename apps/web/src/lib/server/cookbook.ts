import { resolveCookbookLocation } from '../../features/cookbook/model/routing';
import type { CookbookLocation } from '../../features/cookbook/model/routing';
import type { CookbookResponse, RecipeDetail } from '../../features/cookbook/model/types';

const defaultApiOrigin: string = 'http://localhost:3000';

export interface ServerRecipePage {
  cookbook: CookbookResponse;
  location: CookbookLocation;
  recipe: RecipeDetail;
}

export async function loadServerRecipePage(
  pathname: string,
  cookie: string | null,
): Promise<ServerRecipePage | null> {
  const tenantSlug: string | null = tenantSlugFromPath(pathname);
  if (tenantSlug === null) return null;

  const cookbook: CookbookResponse | null = await getJson<CookbookResponse>(
    `/cookbook?tenantSlug=${encodeURIComponent(tenantSlug)}`,
    cookie,
  );
  if (cookbook === null) return null;

  const location: CookbookLocation = resolveCookbookLocation(cookbook, pathname);
  if (location.recipe === null) return null;

  const variantQuery: string =
    location.variantSlug === null ? '' : `?variant=${encodeURIComponent(location.variantSlug)}`;
  const recipe: RecipeDetail | null = await getJson<RecipeDetail>(
    `/cookbook/recipes/${encodeURIComponent(location.recipe.public_id)}${variantQuery}`,
    cookie,
  );
  if (recipe === null) return null;

  return { cookbook, location, recipe };
}

async function getJson<ResponseBody>(path: string, cookie: string | null): Promise<ResponseBody | null> {
  const apiOrigin: string = process.env.SHADOWCOOK_API_ORIGIN ?? defaultApiOrigin;
  try {
    const response: Response = await fetch(new URL(path, apiOrigin), {
      headers: cookie === null || cookie.length === 0 ? {} : { cookie },
    });
    if (!response.ok) return null;
    return (await response.json()) as ResponseBody;
  } catch (_error: unknown) {
    return null;
  }
}

function tenantSlugFromPath(pathname: string): string | null {
  const segments: string[] = pathname
    .split('/')
    .filter((segment: string): boolean => segment.length > 0);
  if (segments.length === 0) return null;
  return decodeURIComponent(segments[0]);
}
