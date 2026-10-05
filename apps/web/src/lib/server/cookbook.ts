import { resolveCookbookLocation } from '../../features/cookbook/model/routing';
import type { CookbookLocation } from '../../features/cookbook/model/routing';
import type { CookbookResponse, RecipeDetail } from '../../features/cookbook/model/types';

const defaultApiOrigin: string = 'http://localhost:3000';

export interface ServerRecipePage {
  cookbook: CookbookResponse;
  location: CookbookLocation;
  recipe: RecipeDetail;
}

export interface ServerCookbookPage {
  cookbook: CookbookResponse;
  location: CookbookLocation;
}

export async function loadServerRecipePage(
  pathname: string,
  cookie: string | null,
): Promise<ServerRecipePage | null> {
  const cookbookPage: ServerCookbookPage | null = await loadServerCookbookPage(pathname, cookie);
  if (cookbookPage === null || cookbookPage.location.recipe === null) return null;

  const variantQuery: string =
    cookbookPage.location.variantSlug === null
      ? ''
      : `?variant=${encodeURIComponent(cookbookPage.location.variantSlug)}`;
  const recipe: RecipeDetail | null = await getJson<RecipeDetail>(
    `/cookbook/recipes/${encodeURIComponent(cookbookPage.location.recipe.public_id)}${variantQuery}`,
    cookie,
  );
  if (recipe === null) return null;

  return { cookbook: cookbookPage.cookbook, location: cookbookPage.location, recipe };
}

export async function loadServerCookbookPage(
  pathname: string,
  cookie: string | null,
  refreshFrontpageShuffle: boolean = false,
): Promise<ServerCookbookPage | null> {
  const tenantSlug: string | null = tenantSlugFromPath(pathname);
  if (tenantSlug === null) return null;

  const cookbook: CookbookResponse | null = await getJson<CookbookResponse>(
    `/cookbook?tenantSlug=${encodeURIComponent(tenantSlug)}${refreshFrontpageShuffle ? '&refreshFrontpageShuffle=true' : ''}`,
    cookie,
  );
  if (cookbook === null) return null;

  const location: CookbookLocation = resolveCookbookLocation(cookbook, pathname);
  if (!isCookbookPath(pathname, location)) return null;
  return { cookbook, location };
}

async function getJson<ResponseBody>(
  path: string,
  cookie: string | null,
): Promise<ResponseBody | null> {
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

function isCookbookPath(pathname: string, location: CookbookLocation): boolean {
  const segments: string[] = pathname
    .split('/')
    .filter((segment: string): boolean => segment.length > 0);
  return segments.length === 1 || location.categoryId !== null || location.recipe !== null;
}
