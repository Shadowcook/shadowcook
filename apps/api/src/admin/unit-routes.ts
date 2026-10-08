import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { requireInstancePermission } from './authorization.js';
import { convertAmount, decimal, displayDecimal } from '../unit-domain.js';

type UnitDimension = 'MASS' | 'VOLUME' | 'COUNT' | 'TEMPERATURE';

interface UnitInput {
  name: string;
  symbol: string;
  dimension: UnitDimension;
  baseFactor: string;
  baseOffset: string;
}

interface UnitRow {
  public_id: string;
  name: string;
  symbol: string;
  localization_key: string | null;
  dimension: UnitDimension;
  base_factor: string;
  base_offset: string;
  usage_count: number;
}

const dimensions: ReadonlySet<string> = new Set(['MASS', 'VOLUME', 'COUNT', 'TEMPERATURE']);

export function registerUnitRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/admin/units', async (request, reply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    const result = await pool.query<UnitRow>(`
      SELECT unit.public_id, unit.name, unit.symbol, unit.localization_key, unit.dimension, unit.base_factor::text,
        unit.base_offset::text, count(ingredient_usage.id)::integer AS usage_count
      FROM unit
      LEFT JOIN ingredient_usage ON ingredient_usage.unit_id = unit.id
      WHERE unit.owner_tenant_id IS NULL
      GROUP BY unit.id
      ORDER BY unit.dimension, unit.name`);
    return reply.send({ units: result.rows.map(unitResponse) });
  });

  api.post('/admin/units', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    const unit = parseUnitInput(request.body);
    if (unit === null) return invalidUnit(reply);
    try {
      const result = await pool.query<UnitRow>(
        `INSERT INTO unit (name, symbol, dimension, base_factor, base_offset)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING public_id, name, symbol, localization_key, dimension, base_factor::text, base_offset::text, 0::integer AS usage_count`,
        [unit.name, unit.symbol, unit.dimension, unit.baseFactor, unit.baseOffset],
      );
      return reply.code(201).send(unitResponse(result.rows[0]!));
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return duplicateUnit(reply);
      throw error;
    }
  });

  api.patch('/admin/units/:publicId', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    const unit = parseUnitInput(request.body);
    if (unit === null) return invalidUnit(reply);
    const publicId = (request.params as { publicId: string }).publicId;
    try {
      const result = await pool.query<UnitRow>(
        `UPDATE unit SET name = $1, symbol = $2, dimension = $3, base_factor = $4, base_offset = $5
         WHERE public_id = $6 AND owner_tenant_id IS NULL
         RETURNING public_id, name, symbol, localization_key, dimension, base_factor::text, base_offset::text, 0::integer AS usage_count`,
        [unit.name, unit.symbol, unit.dimension, unit.baseFactor, unit.baseOffset, publicId],
      );
      if (result.rowCount !== 1)
        return reply.code(404).send({ code: 'UNIT_NOT_FOUND', error: 'The unit was not found.' });
      return reply.code(204).send();
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return duplicateUnit(reply);
      throw error;
    }
  });

  api.delete('/admin/units/:publicId', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    const publicId = (request.params as { publicId: string }).publicId;
    const result = await pool.query(
      `DELETE FROM unit
       WHERE public_id = $1 AND owner_tenant_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM ingredient_usage WHERE ingredient_usage.unit_id = unit.id)`,
      [publicId],
    );
    if (result.rowCount === 1) {
      return reply.code(204).send();
    }
    const exists = await pool.query(
      'SELECT EXISTS (SELECT 1 FROM unit WHERE public_id = $1 AND owner_tenant_id IS NULL) AS exists',
      [publicId],
    );
    if (exists.rows[0]?.exists === true)
      return reply.code(409).send({
        code: 'UNIT_IN_USE',
        error: 'The unit is used by recipe ingredients and cannot be deleted.',
      });
    return reply.code(404).send({ code: 'UNIT_NOT_FOUND', error: 'The unit was not found.' });
  });

  api.post('/admin/units/convert', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((await requireInstancePermission(pool, request, reply, 'instance:administer')) === null)
      return;
    const body = request.body as Record<string, unknown>;
    const amount = decimal(body.amount, false);
    if (
      amount === null ||
      typeof body.sourceUnitPublicId !== 'string' ||
      typeof body.targetUnitPublicId !== 'string'
    )
      return reply
        .code(400)
        .send({ code: 'INVALID_CONVERSION', error: 'The conversion is invalid.' });
    const result = await pool.query<
      Pick<UnitRow, 'public_id' | 'dimension' | 'base_factor' | 'base_offset'>
    >(
      `SELECT public_id, dimension, base_factor::text, base_offset::text FROM unit
       WHERE public_id = ANY($1::uuid[]) AND owner_tenant_id IS NULL`,
      [[body.sourceUnitPublicId, body.targetUnitPublicId]],
    );
    const source = result.rows.find((row) => row.public_id === body.sourceUnitPublicId);
    const target = result.rows.find((row) => row.public_id === body.targetUnitPublicId);
    if (source === undefined || target === undefined)
      return reply.code(404).send({ code: 'UNIT_NOT_FOUND', error: 'The unit was not found.' });
    const converted = await convertAmount(pool, amount, source, target);
    if (converted === null)
      return reply.code(409).send({
        code: 'UNIT_NOT_CONVERTIBLE',
        error: 'Both units must be convertible and have the same dimension.',
      });
    return reply.send(converted);
  });
}

function parseUnitInput(value: unknown): UnitInput | null {
  if (typeof value !== 'object' || value === null) return null;
  const input = value as Record<string, unknown>;
  const name = trimmed(input.name);
  const symbol = trimmed(input.symbol);
  const dimension = input.dimension;
  const baseFactor = decimal(input.baseFactor, true);
  const baseOffset = decimal(input.baseOffset, false);
  if (
    name === null ||
    symbol === null ||
    !dimensions.has(String(dimension)) ||
    baseFactor === null ||
    baseOffset === null ||
    (dimension !== 'TEMPERATURE' && Number(baseOffset) !== 0)
  )
    return null;
  return { name, symbol, dimension: dimension as UnitDimension, baseFactor, baseOffset };
}

function trimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result.length > 0 && result.length <= 100 ? result : null;
}

function unitResponse(unit: UnitRow): object {
  return {
    publicId: unit.public_id,
    name: unit.name,
    symbol: unit.symbol,
    localizationKey: unit.localization_key,
    dimension: unit.dimension,
    baseFactor: displayDecimal(unit.base_factor),
    baseOffset: displayDecimal(unit.base_offset),
    usageCount: unit.usage_count,
  };
}

function invalidUnit(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ code: 'INVALID_UNIT', error: 'The unit is invalid.' });
}

function duplicateUnit(reply: FastifyReply): FastifyReply {
  return reply.code(409).send({
    code: 'UNIT_CONFLICT',
    error: 'The unit name or symbol is already in use.',
  });
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
