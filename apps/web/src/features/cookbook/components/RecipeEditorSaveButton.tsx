import type { JSX } from 'react';
import AdminIcon from '../../../components/AdminIcon';

interface RecipeEditorSaveButtonProperties {
  label: string;
  disabled: boolean;
  form?: string;
  onClick?: () => void;
}

export default function RecipeEditorSaveButton(
  properties: RecipeEditorSaveButtonProperties,
): JSX.Element {
  return (
    <button
      type={properties.form === undefined ? 'button' : 'submit'}
      form={properties.form}
      className="recipe-editor__save-button button--secondary"
      disabled={properties.disabled}
      onClick={properties.onClick}
      aria-label={properties.label}
      title={properties.label}
    >
      <span className="recipe-editor-action-bar__button-icon">
        <AdminIcon name="save" />
      </span>
      <span className="recipe-editor-action-bar__button-label">{properties.label}</span>
    </button>
  );
}
