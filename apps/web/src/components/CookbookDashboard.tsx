import type { JSX } from 'react';
import type { Translation } from '../i18n';
import BreadcrumbBar from './BreadcrumbBar';
import CategoryTree from './CategoryTree';
import RecipeDetailView from './RecipeDetailView';
import type { Category, CookbookResponse, Recipe, RecipeDetail } from './cookbook-types';

interface CookbookDashboardProperties {
  text: Translation;
  email: string;
  cookbook: CookbookResponse;
  isAuthenticated: boolean;
  selectedCategoryId: string | null;
  selectedRecipe: RecipeDetail | null;
  isRecipeLoading: boolean;
  recipeError: string;
  onSelectCategory: (categoryId: string | null) => void;
  onSelectRecipe: (publicId: string) => Promise<void>;
  onCloseRecipe: () => void;
  onLogin: () => void;
  onLogout: () => Promise<void>;
  onManageCookbook: () => void;
}

export default function CookbookDashboard(properties: CookbookDashboardProperties): JSX.Element {
  const {
    text,
    email,
    cookbook,
    isAuthenticated,
    selectedCategoryId,
    selectedRecipe,
    isRecipeLoading,
    recipeError,
    onSelectCategory,
    onSelectRecipe,
    onCloseRecipe,
    onLogin,
    onLogout,
    onManageCookbook,
  } = properties;
  const categoryNames: Map<string, string> = new Map(
    cookbook.categories.map((category: Category): [string, string] => [
      category.public_id,
      category.name,
    ]),
  );
  const recipes: Recipe[] =
    selectedCategoryId === null
      ? cookbook.recipes
      : cookbook.recipes.filter((recipe: Recipe): boolean =>
          recipe.category_public_ids.includes(selectedCategoryId),
        );
  const cookbookName: string = cookbook.tenant?.display_name ?? text.dashboard.cookbook;
  return (
    <section className="dashboard">
      <header className="dashboard__header">
        <div>
          <p className="eyebrow">{cookbookName}</p>
          <h1>{text.dashboard.greeting}</h1>
        </div>
        <div className="account">
          {cookbook.canManageRecipes || cookbook.canManageCategories ? (
            <button type="button" className="button--secondary" onClick={onManageCookbook}>
              {text.tenantNavigation.title}
            </button>
          ) : null}
          {isAuthenticated ? (
            <>
              <span>{email}</span>
              <button
                className="button--secondary"
                type="button"
                onClick={(): void => void onLogout()}
              >
                {text.dashboard.logout}
              </button>
            </>
          ) : (
            <button className="button--secondary" type="button" onClick={onLogin}>
              {text.dashboard.login}
            </button>
          )}
        </div>
      </header>
      <BreadcrumbBar
        categories={cookbook.categories}
        selectedCategoryId={selectedCategoryId}
        selectedRecipe={selectedRecipe}
        cookbookName={cookbookName}
        text={text}
        onSelectCategory={onSelectCategory}
      />
      {selectedRecipe !== null ? (
        <RecipeDetailView text={text} recipe={selectedRecipe} onClose={onCloseRecipe} />
      ) : (
        <div className="cookbook-layout">
          <aside className="category-panel">
            <div className="category-panel__heading">
              <p className="eyebrow">{text.dashboard.categories}</p>
            </div>
            <button
              className={
                selectedCategoryId === null
                  ? 'category-button category-button--active'
                  : 'category-button'
              }
              type="button"
              onClick={(): void => onSelectCategory(null)}
            >
              {text.dashboard.allCategories}
            </button>
            <CategoryTree
              categories={cookbook.categories}
              selectedCategoryId={selectedCategoryId}
              text={text}
              onSelectCategory={onSelectCategory}
            />
          </aside>
          <section className="recipes-panel">
            <div className="recipes-panel__heading">
              <p className="eyebrow">{text.dashboard.recipes}</p>
              <div className="recipes-panel__actions">
                <strong>{recipes.length}</strong>
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
            {recipes.length === 0 ? (
              <p className="empty-state">{text.dashboard.noRecipes}</p>
            ) : (
              <div className="recipe-grid">
                {recipes.map((recipe: Recipe): JSX.Element => (
                  <article className="recipe-card" key={recipe.public_id}>
                    <button
                      className="recipe-card__button"
                      type="button"
                      onClick={(): void => void onSelectRecipe(recipe.public_id)}
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
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
