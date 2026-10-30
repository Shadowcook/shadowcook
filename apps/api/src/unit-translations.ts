import type { PoolClient } from 'pg';

export interface UnitTranslation {
  name: string;
  symbol: string;
}

export type UnitTranslations = Record<string, UnitTranslation>;

export function unitTranslationsSql(unitAlias: string = 'unit'): string {
  return `COALESCE((SELECT jsonb_object_agg(translation.locale,
    jsonb_build_object('name', translation.name, 'symbol', translation.symbol))
    FROM unit_translation AS translation WHERE translation.unit_id = ${unitAlias}.id), '{}'::jsonb)`;
}

export function parseUnitTranslations(value: unknown): UnitTranslations | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const result: UnitTranslations = {};
  const entries: [string, unknown][] = Object.entries(value);
  if (entries.length > 50) return null;
  for (const [locale, translation] of entries) {
    if (locale === 'en' || !/^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|[0-9]{3}))?$/.test(locale))
      return null;
    if (typeof translation !== 'object' || translation === null || Array.isArray(translation))
      return null;
    const fields: Record<string, unknown> = translation as Record<string, unknown>;
    if (Object.keys(fields).some((key: string): boolean => key !== 'name' && key !== 'symbol'))
      return null;
    if (typeof fields.name !== 'string' || typeof fields.symbol !== 'string') return null;
    const name: string = fields.name.trim();
    const symbol: string = fields.symbol.trim();
    if (name.length === 0 || name.length > 100 || symbol.length === 0 || symbol.length > 100)
      return null;
    result[locale] = { name, symbol };
  }
  return result;
}

export async function replaceUnitTranslations(
  client: PoolClient,
  publicId: string,
  translations: UnitTranslations | undefined,
): Promise<void> {
  if (translations === undefined) return;
  await client.query(
    'DELETE FROM unit_translation WHERE unit_id = (SELECT id FROM unit WHERE public_id = $1)',
    [publicId],
  );
  for (const [locale, translation] of Object.entries(translations)) {
    await client.query(
      `INSERT INTO unit_translation (unit_id, locale, name, symbol)
       SELECT id, $2, $3, $4 FROM unit WHERE public_id = $1`,
      [publicId, locale, translation.name, translation.symbol],
    );
  }
}
