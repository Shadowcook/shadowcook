import type { JSX } from 'react';

interface RecipeLink {
  public_id: string;
  slug: string;
  title: string;
}

interface RecipeInstructionProperties {
  instruction: string;
  recipeLinks: RecipeLink[];
  tenantSlug?: string;
}

const recipeLinkPattern: RegExp = /\{recipe:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\}/gi;

export default function RecipeInstruction(properties: RecipeInstructionProperties): JSX.Element {
  const linksById: Map<string, RecipeLink> = new Map(
    properties.recipeLinks.map((link: RecipeLink): [string, RecipeLink] => [
      link.public_id.toLowerCase(),
      link,
    ]),
  );
  const parts: JSX.Element[] = [];
  let cursor: number = 0;
  let match: RegExpExecArray | null;
  while ((match = recipeLinkPattern.exec(properties.instruction)) !== null) {
    if (match.index > cursor) parts.push(<span key={cursor}>{properties.instruction.slice(cursor, match.index)}</span>);
    const reference: RecipeLink | undefined = linksById.get(match[1]!.toLowerCase());
    if (reference === undefined || properties.tenantSlug === undefined) {
      parts.push(<span key={match.index}>{match[0]}</span>);
    } else {
      parts.push(
        <a key={match.index} href={`/${encodeURIComponent(properties.tenantSlug)}/recipes/${encodeURIComponent(reference.slug)}`}>
          {reference.title}
        </a>,
      );
    }
    cursor = recipeLinkPattern.lastIndex;
  }
  if (cursor < properties.instruction.length)
    parts.push(<span key={cursor}>{properties.instruction.slice(cursor)}</span>);
  return <>{parts}</>;
}
