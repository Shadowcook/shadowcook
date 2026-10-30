export const recipeSkillPath: string = '/skills/shadowcook-recipe/v1';

export interface RecipeAuthoringResources {
  name: string;
  version: string;
  format: string;
  formatVersion: number;
  skillUrl: string;
  schemaUrl: string;
  downloadUrl: string;
  examples: string[];
  instructions: string;
}

export function recipeAuthoringResources(publicApiOrigin: string): RecipeAuthoringResources {
  const baseUrl: string = `${publicApiOrigin.replace(/\/$/, '')}${recipeSkillPath}`;
  return {
    name: 'shadowcook-recipe',
    version: '1',
    format: 'shadowcook-recipe',
    formatVersion: 1,
    skillUrl: `${baseUrl}/SKILL.md`,
    schemaUrl: `${baseUrl}/recipe.schema.json`,
    downloadUrl: `${baseUrl}/shadowcook-recipe.zip`,
    examples: [`${baseUrl}/examples/simple.json`, `${baseUrl}/examples/variants.json`],
    instructions:
      'Read skillUrl before composing recipe JSON. Resolve its relative resource links against skillUrl. Fetch skill resources without authentication; never attach the AI context accessToken. Produce a shadowcook-recipe formatVersion 1 document and validate it against schemaUrl and the semantic checks in the skill. Return the JSON file to the user; they can upload it or paste its contents at /{tenantSlug}/manage/recipes/import, review ingredient and unit mappings, and save a new draft. Import endpoints require ordinary cookbook permissions and do not accept AI context reader credentials. The AI context remains read-only.',
  };
}
