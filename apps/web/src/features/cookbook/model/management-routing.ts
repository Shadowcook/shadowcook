export type EditorPath = 'manage' | 'new' | 'drafts' | string | null;

export interface ManagementRoute {
  editorPath: EditorPath;
  isCategoryEditor: boolean;
}

export function managementRoute(pathname: string): ManagementRoute {
  const segments: string[] = pathname
    .split('/')
    .filter((segment: string): boolean => segment.length > 0);
  const isCategoryEditor: boolean = segments.length === 2 && segments[1] === 'categories';

  if (segments.length === 2 && segments[1] === 'drafts')
    return { editorPath: 'drafts', isCategoryEditor };
  if (segments.length === 3 && segments[1] === 'recipes' && segments[2] === 'new')
    return { editorPath: 'new', isCategoryEditor };
  if (segments.length === 4 && segments[1] === 'recipes' && segments[3] === 'edit')
    return { editorPath: segments[2]!, isCategoryEditor };
  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'recipes')
    return { editorPath: 'manage-recipes', isCategoryEditor };
  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'users')
    return { editorPath: 'manage-users', isCategoryEditor };
  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'ingredients')
    return { editorPath: 'manage-ingredients', isCategoryEditor };
  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'units')
    return { editorPath: 'manage-units', isCategoryEditor };
  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'settings')
    return { editorPath: 'manage-recipe-policy', isCategoryEditor };
  if (segments.length === 3 && segments[1] === 'manage' && segments[2] === 'service-accounts')
    return { editorPath: 'manage-service-accounts', isCategoryEditor };
  if (segments.length === 2 && segments[1] === 'manage')
    return { editorPath: 'manage', isCategoryEditor };
  return { editorPath: null, isCategoryEditor };
}
