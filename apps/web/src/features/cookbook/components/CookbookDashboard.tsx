import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';
import AiShareIcon from './AiShareIcon';
import BreadcrumbBar from './BreadcrumbBar';
import CategoryTree from './CategoryTree';
import RecipeDetailView from './RecipeDetailView';
import RecipePagination from './RecipePagination';
import { cookbookPath } from '../model/routing';
import type { Category, CookbookResponse, Recipe, RecipeDetail } from '../model/types';

interface CookbookDashboardProperties {
  text: Translation;
  cookbook: CookbookResponse;
  selectedCategoryId: string | null;
  selectedRecipe: RecipeDetail | null;
  isRecipeLoading: boolean;
  recipeError: string;
  onEditRecipe: () => void;
  onShareRecipe: () => void;
  onShareRecipeWithAi: () => void;
  onShareCategoryWithAi: (categoryId: string) => void;
  onShareCookbookWithAi: () => void;
  onSelectVariant: (slug: string) => void;
  onSelectFrontpagePage: (page: number) => Promise<CookbookResponse>;
  recipeFilter: string;
  onRecipeFilterChange: (filter: string) => void;
  tenantSlug: string;
}

export default function CookbookDashboard(properties: CookbookDashboardProperties): JSX.Element {
  const {
    text,
    cookbook,
    selectedCategoryId,
    selectedRecipe,
    isRecipeLoading,
    recipeError,
    onEditRecipe,
    onShareRecipe,
    onShareRecipeWithAi,
    onShareCategoryWithAi,
    onShareCookbookWithAi,
    onSelectVariant,
    onSelectFrontpagePage,
    recipeFilter,
    onRecipeFilterChange,
    tenantSlug,
  } = properties;
  const [categoryPage, setCategoryPage] = useState<number>(1);
  const categoryNames: Map<string, string> = new Map(
    cookbook.categories.map((category: Category): [string, string] => [
      category.public_id,
      category.name,
    ]),
  );
  const recipes: Recipe[] =
    selectedCategoryId === null
      ? cookbook.frontpage.recipes
      : cookbook.recipes.filter((recipe: Recipe): boolean =>
          recipe.category_public_ids.includes(selectedCategoryId),
        );
  const categoryPageSize: number = 100;
  const categoryTotalPages: number = Math.ceil(recipes.length / categoryPageSize);
  const visibleRecipes: Recipe[] =
    selectedCategoryId === null
      ? recipes
      : recipes.slice((categoryPage - 1) * categoryPageSize, categoryPage * categoryPageSize);
  useEffect((): void => {
    setCategoryPage(1);
  }, [selectedCategoryId, recipeFilter]);
  const cookbookName: string = cookbook.tenant?.display_name ?? text.dashboard.cookbook;
  const frontpageHeading: string = cookbook.tenant?.frontpage_heading ?? text.dashboard.greeting;
  return (
    <section className="dashboard">
      <header className="dashboard__header">
        <div>
          <p className="eyebrow dashboard__cookbook-name">{cookbookName}</p>
          <h1>{frontpageHeading}</h1>
        </div>
        {cookbook.canManageRecipes || cookbook.canManageCategories || cookbook.canManageUsers ? (
          <a className="button--secondary" href={`/${encodeURIComponent(tenantSlug)}/manage/recipes`}>
            {text.tenantNavigation.title}
          </a>
        ) : null}
      </header>
      <BreadcrumbBar
        categories={cookbook.categories}
        selectedCategoryId={selectedCategoryId}
        selectedRecipe={selectedRecipe}
        cookbookName={cookbookName}
        text={text}
        tenantSlug={tenantSlug}
      />
      {selectedRecipe !== null ? (
        <RecipeDetailView
          text={text}
          recipe={selectedRecipe}
          backHref={cookbookPath(tenantSlug, cookbook.categories, selectedCategoryId, null)}
          onEdit={onEditRecipe}
          onShare={onShareRecipe}
          onShareWithAi={onShareRecipeWithAi}
          onSelectVariant={onSelectVariant}
          tenantSlug={tenantSlug}
        />
      ) : (
        <div className="cookbook-layout">
          <aside className="category-panel">
            <div className="category-panel__heading">
              <p className="eyebrow">{text.dashboard.categories}</p>
            </div>
            <a
              className={
                selectedCategoryId === null
                  ? 'category-button category-button--active'
                  : 'category-button'
              }
              href={cookbookPath(tenantSlug, cookbook.categories, null, null)}
            >
              {text.dashboard.allCategories}
            </a>
            <CategoryTree
              categories={cookbook.categories}
              selectedCategoryId={selectedCategoryId}
              text={text}
              tenantSlug={tenantSlug}
            />
          </aside>
          <section className="recipes-panel">
            <div className="recipes-panel__heading">
              <p className="eyebrow">{text.dashboard.recipes}</p>
              <div className="recipes-panel__actions">
                <strong>
                  {selectedCategoryId === null ? cookbook.frontpage.totalRecipes : recipes.length}
                </strong>
                {cookbook.canCreateAiContexts ? (
                  <button
                    type="button"
                    className="button--secondary"
                    onClick={(): void =>
                      selectedCategoryId === null
                        ? onShareCookbookWithAi()
                        : onShareCategoryWithAi(selectedCategoryId)
                    }
                    aria-label={text.recipeEditor.aiContext}
                    title={text.recipeEditor.aiContext}
                  >
                    <AiShareIcon label={text.recipeEditor.aiShareIcon} />
                  </button>
                ) : null}
              </div>
            </div>
            {recipeError.length > 0 ? (
              <p className="message" role="alert">
                {recipeError}
              </p>
            ) : null}
            {isRecipeLoading ? (
              <p className="empty-state" aria-live="polite">
                {text.loading}
              </p>
            ) : null}
            <label className="recipe-filter">
              <span>{text.dashboard.filterRecipes}</span>
              <input
                type="search"
                value={recipeFilter}
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  onRecipeFilterChange(event.target.value)
                }
              />
            </label>
            {visibleRecipes.length === 0 ? (
              <p className="empty-state">{text.dashboard.noRecipes}</p>
            ) : (
              <div className="recipe-grid">
                {visibleRecipes.map((recipe: Recipe): JSX.Element => (
                  <article className="recipe-card" key={recipe.public_id}>
                    <a
                      className="recipe-card__button"
                      href={cookbookPath(
                        tenantSlug,
                        cookbook.categories,
                        selectedCategoryId,
                        recipe,
                      )}
                    >
                      <h2>{recipe.title}</h2>
                      {recipe.summary === null ? null : <p>{recipe.summary}</p>}
                      <div className="recipe-card__categories">
                        {recipe.category_public_ids.length === 0 ? (
                          <span>{text.dashboard.uncategorized}</span>
                        ) : (
                          recipe.category_public_ids.map((categoryId: string): JSX.Element => (
                            <span key={categoryId}>
                              {categoryNames.get(categoryId) ?? text.dashboard.uncategorized}
                            </span>
                          ))
                        )}
                      </div>
                    </a>
                  </article>
                ))}
              </div>
            )}
            {selectedCategoryId === null && cookbook.frontpage.totalPages > 1 ? (
              <RecipePagination
                currentPage={cookbook.frontpage.page}
                totalPages={cookbook.frontpage.totalPages}
                text={text}
                onSelectPage={(page: number): void => {
                  void onSelectFrontpagePage(page);
                }}
              />
            ) : null}
            {selectedCategoryId !== null && categoryTotalPages > 1 ? (
              <RecipePagination
                currentPage={categoryPage}
                totalPages={categoryTotalPages}
                text={text}
                onSelectPage={setCategoryPage}
              />
            ) : null}
          </section>
        </div>
      )}
    </section>
  );
}
