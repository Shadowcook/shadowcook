import type { Pool } from 'pg';

export type UnitDimension = 'MASS' | 'VOLUME' | 'COUNT' | 'TEMPERATURE';
export interface ConvertibleUnitRow {
  public_id: string;
  dimension: UnitDimension | null;
  base_factor: string | null;
  base_offset: string | null;
}
export const decimalPattern: RegExp = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,12})?$/;
export function decimal(value: unknown, positive: boolean): string | null {
  if (typeof value !== 'string' || !decimalPattern.test(value)) return null;
  if (!positive) return value;
  return value !== '0' && !/^0\.0+$/.test(value) && !value.startsWith('-') ? value : null;
}
export function displayDecimal(value: string): string {
  return value.includes('.') ? value.replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1') : value;
}
export function isConvertible(unit: ConvertibleUnitRow): unit is ConvertibleUnitRow & {
  dimension: UnitDimension;
  base_factor: string;
  base_offset: string;
} {
  return unit.dimension !== null && unit.base_factor !== null && unit.base_offset !== null;
}
export async function convertAmount(
  pool: Pool,
  amount: string,
  source: ConvertibleUnitRow,
  target: ConvertibleUnitRow,
): Promise<{ amount: string; dimension: UnitDimension } | null> {
  if (!isConvertible(source) || !isConvertible(target) || source.dimension !== target.dimension)
    return null;
  const result = await pool.query<{ amount: string }>(
    `SELECT (($1::numeric * $2::numeric + $3::numeric - $4::numeric) / $5::numeric)::text AS amount`,
    [amount, source.base_factor, source.base_offset, target.base_offset, target.base_factor],
  );
  return { amount: displayDecimal(result.rows[0]!.amount), dimension: source.dimension };
}
