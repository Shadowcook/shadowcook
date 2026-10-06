import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import type { ZxcvbnResult } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary as commonDictionary } from '@zxcvbn-ts/language-common';
import { dictionary as germanDictionary } from '@zxcvbn-ts/language-de';
import { dictionary as englishDictionary, translations } from '@zxcvbn-ts/language-en';

const logarithmBase2Of10: number = Math.log2(10);
export const passwordAnalysisMaximumLength: number = 64;
const passwordStrength: ZxcvbnFactory = new ZxcvbnFactory({
  dictionary: { ...commonDictionary, ...englishDictionary, ...germanDictionary },
  graphs: adjacencyGraphs,
  translations,
});

export function estimatePasswordEntropy(password: string): number {
  const analyzedPassword: string = password.slice(0, passwordAnalysisMaximumLength);
  const result: ZxcvbnResult = passwordStrength.check(analyzedPassword);
  if (result.sequence.every((match): boolean => match.pattern === 'bruteforce'))
    return estimateRandomPasswordEntropy(analyzedPassword);
  return result.guessesLog10 * logarithmBase2Of10;
}

function estimateRandomPasswordEntropy(password: string): number {
  const characters: string[] = Array.from(password);
  if (characters.length === 0) return 0;
  let characterPoolSize: number = 0;
  if (characters.some((character: string): boolean => /[a-z]/.test(character)))
    characterPoolSize += 26;
  if (characters.some((character: string): boolean => /[A-Z]/.test(character)))
    characterPoolSize += 26;
  if (characters.some((character: string): boolean => /[0-9]/.test(character)))
    characterPoolSize += 10;
  if (characters.some((character: string): boolean => /\s/.test(character))) characterPoolSize += 1;
  if (characters.some((character: string): boolean => !/[A-Za-z0-9\s]/.test(character)))
    characterPoolSize += 33;
  return characters.length * Math.log2(characterPoolSize);
}
