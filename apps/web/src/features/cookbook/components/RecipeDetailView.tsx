import type { JSX } from 'react';
import RecipeSteps from './RecipeSteps';
import RecipeMetadata from './RecipeMetadata';
import type { Translation } from '../../../i18n';
import AdminIcon from '../../../components/AdminIcon';
import type { RecipeDetail, RecipeVariant } from '../model/types';
import RecipeShoppingList from './RecipeShoppingList';
import AiShareIcon from './AiShareIcon';
import ReportButton from '../../reports/ReportButton';
import ContentActions from '../../../components/ContentActions';
import CopyLinkAction from '../../../components/CopyLinkAction';
import RecipePdfDownloadButton from './RecipePdfDownloadButton';
import RecipeContributors from './RecipeContributors';
import RecipeDietIcon from './RecipeDietIcon';

interface RecipeDetailViewProperties {
  text: Translation;
  recipe: RecipeDetail;
  backHref: string;
  onEdit: () => void;
  onShare: () => void;
  onShareWithAi: () => void;
  onSelectVariant: (slug: string) => void;
  tenantSlug?: string;
  shareToken?: string;
}

export default function RecipeDetailView({
  text,
  recipe,
  backHref,
  onEdit,
  onShare,
  onShareWithAi,
  onSelectVariant,
  tenantSlug,
  shareToken,
}: RecipeDetailViewProperties): JSX.Element {
  const hasVisibleAlternative: boolean = recipe.variants.some(
    (variant: RecipeVariant): boolean => !variant.is_default && variant.is_visible,
  );

  return (
    <section className="recipe-detail">
      <a className="button--secondary recipe-detail__back" href={backHref}>
        {text.dashboard.backToRecipes}
      </a>
      <div className="recipe-detail__title">
        <h2>
          {recipe.title} <RecipeDietIcon diet={recipe.diet} text={text} showLabel />
        </h2>
        <div className="recipe-detail__actions">
          <RecipePdfDownloadButton recipe={recipe} text={text} tenantSlug={tenantSlug} />
          <ContentActions label={`${text.reports.moreActions}: ${recipe.title}`}>
            <CopyLinkAction text={text} />
            {recipe.can_edit ? (
              <button
                type="button"
                className="content-actions__item"
                onClick={onEdit}
                aria-label={text.recipeEditor.edit}
                title={text.recipeEditor.edit}
              >
                <AdminIcon name="edit" />
                {text.recipeEditor.edit}
              </button>
            ) : null}
            {recipe.can_share ? (
              <button
                type="button"
                className="content-actions__item"
                onClick={onShare}
                aria-label={text.recipeEditor.share}
                title={text.recipeEditor.share}
              >
                <AdminIcon name="share" />
                {text.recipeEditor.share}
              </button>
            ) : null}
            {recipe.can_share ? (
              <button
                type="button"
                className="content-actions__item"
                onClick={onShareWithAi}
                aria-label={text.recipeEditor.aiContext}
                title={text.recipeEditor.aiContext}
              >
                <AiShareIcon label={text.recipeEditor.aiShareIcon} />
                {text.recipeEditor.aiContext}
              </button>
            ) : null}
            <ReportButton
              text={text}
              targetType="RECIPE"
              targetPublicId={recipe.public_id}
              targetName={recipe.title}
              shareToken={shareToken}
            />
          </ContentActions>
        </div>
      </div>
      <div className="recipe-detail__overview">
        <div className="recipe-detail__overview-content">
          {recipe.image_url ? (
            <img
              className="recipe-detail__image"
              src={recipe.image_url}
              alt={text.recipeImage.alt}
              width={1200}
              height={800}
            />
          ) : null}
          {recipe.summary === null ? null : (
            <p className="recipe-detail__summary">{recipe.summary}</p>
          )}
          {hasVisibleAlternative ? (
            <label className="recipe-detail__variant">
              {text.recipeEditor.variant}
              <select
                value={recipe.selectedVariant}
                onChange={(event): void => onSelectVariant(event.currentTarget.value)}
              >
                {recipe.variants.map((variant) => (
                  <option key={variant.variant_key} value={variant.slug}>
                    {variant.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <RecipeShoppingList recipe={recipe} text={text} />
      </div>
      <RecipeSteps
        steps={recipe.steps}
        recipeLinks={recipe.recipe_links}
        tenantSlug={tenantSlug}
        text={text}
      />
      <RecipeContributors contributors={recipe.contributors ?? []} text={text} />
      <RecipeMetadata recipe={recipe} text={text} />
    </section>
  );
}
