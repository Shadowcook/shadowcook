import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { requireTenantPermission } from '../admin/authorization.js';

type UnitDimension = 'MASS' | 'VOLUME' | 'COUNT' | 'TEMPERATURE';

interface UnitRow {
  public_id: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  base_factor: string;
  base_offset: string;
  usage_count: number;
}
interface UnitInput {
  name: string;
  symbol: string;
  dimension: UnitDimension;
  baseFactor: string;
  baseOffset: string;
}

const dimensions: ReadonlySet<string> = new Set(['MASS', 'VOLUME', 'COUNT', 'TEMPERATURE']);
const decimalPattern: RegExp = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,12})?$/;

export function registerTenantUnitRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/cookbook/tenants/:tenantSlug/units', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply, 'unit:read');
    if (tenantId === null) return;
    const units = await pool.query<UnitRow>(
      `SELECT unit.public_id, unit.name, unit.symbol, unit.dimension, unit.base_factor::text,
         unit.base_offset::text, count(ingredient_usage.id)::integer AS usage_count
       FROM unit
       LEFT JOIN ingredient_usage ON ingredient_usage.unit_id = unit.id
       WHERE unit.owner_tenant_id = $1
       GROUP BY unit.id
       ORDER BY unit.dimension, unit.name`,
      [tenantId],
    );
    return reply.send({ units: units.rows.map(unitResponse) });
  });

  api.post('/cookbook/tenants/:tenantSlug/units', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply, 'unit:create');
    if (tenantId === null) return;
    const unit: UnitInput | null = parseUnitInput(request.body);
    if (unit === null) return invalidUnit(reply);
    try {
      const result = await pool.query<UnitRow>(
        `INSERT INTO unit (owner_tenant_id, name, symbol, dimension, base_factor, base_offset)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING public_id, name, symbol, dimension, base_factor::text, base_offset::text,
           0::integer AS usage_count`,
        [tenantId, unit.name, unit.symbol, unit.dimension, unit.baseFactor, unit.baseOffset],
      );
      return reply.code(201).send(unitResponse(result.rows[0]!));
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return duplicateUnit(reply);
      throw error;
    }
  });

  api.patch('/cookbook/tenants/:tenantSlug/units/:publicId', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply, 'unit:update');
    if (tenantId === null) return;
    const unit: UnitInput | null = parseUnitInput(request.body);
    if (unit === null) return invalidUnit(reply);
    try {
      const result = await pool.query(
        `UPDATE unit SET name = $1, symbol = $2, dimension = $3, base_factor = $4, base_offset = $5
         WHERE owner_tenant_id = $6 AND public_id = $7`,
        [
          unit.name,
          unit.symbol,
          unit.dimension,
          unit.baseFactor,
          unit.baseOffset,
          tenantId,
          (request.params as { publicId: string }).publicId,
        ],
      );
      return result.rowCount === 1 ? reply.code(204).send() : unitNotFound(reply);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return duplicateUnit(reply);
      throw error;
    }
  });

  api.delete('/cookbook/tenants/:tenantSlug/units/:publicId', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply, 'unit:delete');
    if (tenantId === null) return;
    const publicId: string = (request.params as { publicId: string }).publicId;
    const result = await pool.query(
      `DELETE FROM unit WHERE owner_tenant_id = $1 AND public_id = $2
       AND NOT EXISTS (SELECT 1 FROM ingredient_usage WHERE ingredient_usage.unit_id = unit.id)`,
      [tenantId, publicId],
    );
    if (result.rowCount === 1) return reply.code(204).send();
    const exists = await pool.query(
      'SELECT 1 FROM unit WHERE owner_tenant_id = $1 AND public_id = $2',
      [tenantId, publicId],
    );
    return exists.rowCount === 1
      ? reply.code(409).send({ code: 'UNIT_IN_USE', error: 'The unit is in use.' })
      : unitNotFound(reply);
  });
}

async function tenantIdFor(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string,
): Promise<string | null> {
  return requireTenantPermission(
    pool,
    request,
    reply,
    (request.params as { tenantSlug: string }).tenantSlug,
    permission,
  );
}
function parseUnitInput(value: unknown): UnitInput | null {
  if (typeof value !== 'object' || value === null) return null;
  const input = value as Record<string, unknown>;
  const name: string | null = trimmed(input.name);
  const symbol: string | null = trimmed(input.symbol);
  const dimension: unknown = input.dimension;
  const baseFactor: string | null = decimal(input.baseFactor, true);
  const baseOffset: string | null = decimal(input.baseOffset, false);
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
  const result: string = value.trim();
  return result.length > 0 && result.length <= 100 ? result : null;
}
function decimal(value: unknown, positive: boolean): string | null {
  if (typeof value !== 'string' || !decimalPattern.test(value) || (positive && Number(value) <= 0))
    return null;
  return value;
}
function unitResponse(unit: UnitRow): object {
  return {
    publicId: unit.public_id,
    name: unit.name,
    symbol: unit.symbol,
    dimension: unit.dimension,
    baseFactor: displayDecimal(unit.base_factor),
    baseOffset: displayDecimal(unit.base_offset),
    usageCount: unit.usage_count,
  };
}
function displayDecimal(value: string): string {
  return value.includes('.') ? value.replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1') : value;
}
function invalidUnit(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ code: 'INVALID_UNIT', error: 'The unit is invalid.' });
}
function duplicateUnit(reply: FastifyReply): FastifyReply {
  return reply
    .code(409)
    .send({ code: 'UNIT_CONFLICT', error: 'The unit name or symbol is already in use.' });
}
function unitNotFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ code: 'UNIT_NOT_FOUND', error: 'The unit was not found.' });
}
function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
