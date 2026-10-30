import type { MatchCandidate, PortableIngredient, PortableUnit, UnitConversion } from './types.js';
import { displayDecimal } from '../unit-domain.js';

export interface IngredientCandidate extends MatchCandidate {
  aliases: { publicId: string; name: string }[];
}

export function normalizedName(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}

function nameScore(first: string, second: string): number {
  const firstName: string = normalizedName(first);
  const secondName: string = normalizedName(second);
  if (firstName === secondName) return 100;
  const left: string = firstName.slice(0, 256);
  const right: string = secondName.slice(0, 256);
  if (left.length < 2 || right.length < 2) return 0;
  const pairs: Set<string> = new Set();
  for (let index: number = 0; index < left.length - 1; index += 1)
    pairs.add(left.slice(index, index + 2));
  const other: Set<string> = new Set();
  for (let index: number = 0; index < right.length - 1; index += 1)
    other.add(right.slice(index, index + 2));
  const overlap: number = [...pairs].filter((pair: string): boolean => other.has(pair)).length;
  return (90 * (2 * overlap)) / (pairs.size + other.size);
}

export function equivalentConversion(
  source: UnitConversion,
  target: UnitConversion | null,
): boolean {
  return (
    target !== null &&
    source.dimension === target.dimension &&
    displayDecimal(source.baseFactor) === displayDecimal(target.baseFactor) &&
    displayDecimal(source.baseOffset) === displayDecimal(target.baseOffset)
  );
}

export function ingredientSuggestions(
  source: PortableIngredient,
  catalogue: IngredientCandidate[],
): MatchCandidate[] {
  const names: string[] = [source.name, ...(source.aliases ?? [])];
  return catalogue
    .map((candidate: IngredientCandidate): { candidate: MatchCandidate; score: number } => {
      let canonical: number = 0;
      let alias: number = 0;
      for (const name of names) {
        canonical = Math.max(canonical, nameScore(name, candidate.name));
        for (const item of candidate.aliases) alias = Math.max(alias, nameScore(name, item.name));
      }
      return {
        candidate: {
          publicId: candidate.publicId,
          name: candidate.name,
          symbol: null,
          conversion: null,
          match: canonical === 100 ? 'EXACT' : alias === 100 ? 'ALIAS' : 'SIMILAR',
        },
        score: Math.max(canonical, alias === 100 ? 99 : alias),
      };
    })
    .filter((item): boolean => item.score >= 35)
    .sort((a, b): number => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name))
    .slice(0, 10)
    .map((item): MatchCandidate => item.candidate);
}

export function unitSuggestions(
  source: PortableUnit,
  catalogue: MatchCandidate[],
): MatchCandidate[] {
  return catalogue
    .filter(
      (candidate: MatchCandidate): boolean =>
        source.conversion === undefined ||
        equivalentConversion(source.conversion, candidate.conversion),
    )
    .map((candidate: MatchCandidate): { candidate: MatchCandidate; score: number } => {
      const score: number = Math.max(
        nameScore(source.name, candidate.name),
        nameScore(source.symbol, candidate.symbol ?? ''),
        ...Object.values(candidate.translations ?? {}).flatMap((translation): number[] => [
          nameScore(source.name, translation.name),
          nameScore(source.symbol, translation.symbol),
        ]),
      );
      return {
        candidate: {
          ...candidate,
          match:
            source.conversion !== undefined ? 'DEFINITION' : score === 100 ? 'EXACT' : 'SIMILAR',
        },
        score: source.conversion !== undefined ? 100 + score : score,
      };
    })
    .filter((item): boolean => item.score >= 35)
    .sort((a, b): number => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name))
    .slice(0, 10)
    .map((item): MatchCandidate => item.candidate);
}

export function suggestedMatch(
  candidates: MatchCandidate[],
  unitHasDefinition: boolean = false,
): string | null {
  const exact: MatchCandidate[] = candidates.filter((candidate: MatchCandidate): boolean =>
    unitHasDefinition
      ? candidate.match === 'DEFINITION'
      : candidate.match === 'EXACT' || candidate.match === 'ALIAS',
  );
  return exact.length === 1 ? exact[0]!.publicId : null;
}
