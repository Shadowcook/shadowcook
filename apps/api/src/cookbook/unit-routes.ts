import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { requireTenantPermission } from '../admin/authorization.js';
import { decimal, displayDecimal, type UnitDimension } from '../unit-domain.js';

interface UnitRow {
  public_id: string;
  name: string;
  symbol: string;
  localization_key: string | null;
  dimension: UnitDimension | null;
  base_factor: string | null;
  base_offset: string | null;
  usage_count: number;
}
interface UnitInput {
  name: string;
  symbol: string;
  equivalenceAmount: string | null;
  referenceUnitPublicId: string | null;
  conversionProvided: boolean;
}

export function registerTenantUnitRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/cookbook/tenants/:tenantSlug/units', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply, 'unit:read');
    if (tenantId === null) return;
    const [units, referenceUnits] = await Promise.all([
      listUnits(pool, 'owner_tenant_id = $1', [tenantId], true),
      listUnits(
        pool,
        "(owner_tenant_id IS NULL OR owner_tenant_id = $1) AND dimension IS NOT NULL AND dimension <> 'TEMPERATURE'",
        [tenantId],
        false,
      ),
    ]);
    return reply.send({
      units: units.map(unitResponse),
      referenceUnits: referenceUnits.map(unitResponse),
    });
  });
  api.post('/cookbook/tenants/:tenantSlug/units', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply, 'unit:create');
    if (tenantId === null) return;
    const input: UnitInput | null = parseUnitInput(request.body);
    if (input === null) return invalidUnit(reply);
    const conversion = await conversionFor(pool, tenantId, input);
    if (conversion === 'invalid') return invalidReference(reply);
    if (!(await namesAvailable(pool, tenantId, input.name, input.symbol)))
      return duplicateUnit(reply);
    try {
      const result = await pool.query<UnitRow>(
        `INSERT INTO unit (owner_tenant_id, name, symbol, dimension, base_factor, base_offset) VALUES ($1, $2, $3, $4, $5, $6) RETURNING public_id, name, symbol, localization_key, dimension, base_factor::text, base_offset::text, 0::integer AS usage_count`,
        [
          tenantId,
          input.name,
          input.symbol,
          conversion?.dimension ?? null,
          conversion?.factor ?? null,
          conversion === null ? null : '0',
        ],
      );
      return reply.code(201).send(unitResponse(result.rows[0]!));
    } catch (error: unknown) {
      if (isUnique(error)) return duplicateUnit(reply);
      if (isNumeric(error)) return invalidUnit(reply);
      throw error;
    }
  });
  api.patch('/cookbook/tenants/:tenantSlug/units/:publicId', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply, 'unit:update');
    if (tenantId === null) return;
    const input: UnitInput | null = parseUnitInput(request.body);
    if (input === null) return invalidUnit(reply);
    const publicId: string = (request.params as { publicId: string }).publicId;
    const current = (
      await listUnits(pool, 'owner_tenant_id = $1 AND public_id = $2', [tenantId, publicId], true)
    )[0];
    if (current === undefined) return unitNotFound(reply);
    const conversion = input.conversionProvided
      ? await conversionFor(pool, tenantId, input)
      : current.dimension === null
        ? null
        : { dimension: current.dimension, factor: current.base_factor! };
    if (conversion === 'invalid') return invalidReference(reply);
    const changed =
      current.dimension !== (conversion?.dimension ?? null) ||
      current.base_factor !== (conversion?.factor ?? null) ||
      current.base_offset !== (conversion === null ? null : '0');
    if (current.usage_count > 0 && changed)
      return reply.code(409).send({
        code: 'UNIT_IN_USE',
        error: 'The conversion of a unit used by recipes cannot be changed.',
      });
    if (!(await namesAvailable(pool, tenantId, input.name, input.symbol, publicId)))
      return duplicateUnit(reply);
    try {
      await pool.query(
        'UPDATE unit SET name = $1, symbol = $2, dimension = $3, base_factor = $4, base_offset = $5 WHERE owner_tenant_id = $6 AND public_id = $7',
        [
          input.name,
          input.symbol,
          conversion?.dimension ?? null,
          conversion?.factor ?? null,
          conversion === null ? null : '0',
          tenantId,
          publicId,
        ],
      );
      return reply.code(204).send();
    } catch (error: unknown) {
      if (isNumeric(error)) return invalidUnit(reply);
      throw error;
    }
  });
  api.delete('/cookbook/tenants/:tenantSlug/units/:publicId', async (request, reply) => {
    const tenantId: string | null = await tenantIdFor(pool, request, reply, 'unit:delete');
    if (tenantId === null) return;
    const publicId: string = (request.params as { publicId: string }).publicId;
    const deleted = await pool.query(
      'DELETE FROM unit WHERE owner_tenant_id = $1 AND public_id = $2 AND NOT EXISTS (SELECT 1 FROM ingredient_usage WHERE ingredient_usage.unit_id = unit.id)',
      [tenantId, publicId],
    );
    if (deleted.rowCount === 1) return reply.code(204).send();
    const exists = await pool.query(
      'SELECT 1 FROM unit WHERE owner_tenant_id = $1 AND public_id = $2',
      [tenantId, publicId],
    );
    return exists.rowCount === 1
      ? reply.code(409).send({ code: 'UNIT_IN_USE', error: 'The unit is in use.' })
      : unitNotFound(reply);
  });
}
async function listUnits(
  pool: Pool,
  where: string,
  values: unknown[],
  withUsage: boolean,
): Promise<UnitRow[]> {
  const usage = withUsage ? 'count(ingredient_usage.id)::integer' : '0::integer';
  const join = withUsage ? 'LEFT JOIN ingredient_usage ON ingredient_usage.unit_id = unit.id' : '';
  const group = withUsage ? 'GROUP BY unit.id' : '';
  const result = await pool.query<UnitRow>(
    `SELECT unit.public_id, unit.name, unit.symbol, unit.localization_key, unit.dimension, unit.base_factor::text, unit.base_offset::text, ${usage} AS usage_count FROM unit ${join} WHERE ${where} ${group} ORDER BY unit.name`,
    values,
  );
  return result.rows;
}
async function conversionFor(
  pool: Pool,
  tenantId: string,
  input: UnitInput,
): Promise<{ dimension: UnitDimension; factor: string } | null | 'invalid'> {
  if (input.equivalenceAmount === null) return null;
  const reference = await pool.query<{ dimension: UnitDimension | null; factor: string | null }>(
    `SELECT dimension, base_factor::text AS factor FROM unit WHERE public_id = $1 AND (owner_tenant_id IS NULL OR owner_tenant_id = $2)`,
    [input.referenceUnitPublicId, tenantId],
  );
  const row = reference.rows[0];
  if (
    row === undefined ||
    row.dimension === null ||
    row.dimension === 'TEMPERATURE' ||
    row.factor === null
  )
    return 'invalid';
  const value = await pool.query<{ factor: string }>(
    'SELECT ($1::numeric * $2::numeric)::text AS factor',
    [input.equivalenceAmount, row.factor],
  );
  return { dimension: row.dimension, factor: value.rows[0]!.factor };
}
async function namesAvailable(
  pool: Pool,
  tenantId: string,
  name: string,
  symbol: string,
  except?: string,
): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM unit WHERE (owner_tenant_id IS NULL OR owner_tenant_id = $1) AND (lower(name) = lower($2) OR lower(symbol) = lower($3)) AND ($4::uuid IS NULL OR public_id <> $4::uuid)',
    [tenantId, name, symbol, except ?? null],
  );
  return result.rowCount === 0;
}
function parseUnitInput(value: unknown): UnitInput | null {
  if (typeof value !== 'object' || value === null) return null;
  const input = value as Record<string, unknown>;
  const name = trimmed(input.name);
  const symbol = trimmed(input.symbol);
  const conversionProvided =
    Object.hasOwn(input, 'equivalenceAmount') || Object.hasOwn(input, 'referenceUnitPublicId');
  const rawAmount = input.equivalenceAmount;
  const amount = rawAmount === undefined || rawAmount === null ? null : decimal(rawAmount, true);
  const reference =
    input.referenceUnitPublicId === undefined || input.referenceUnitPublicId === null
      ? null
      : typeof input.referenceUnitPublicId === 'string'
        ? input.referenceUnitPublicId
        : null;
  return name === null ||
    symbol === null ||
    (rawAmount !== undefined && rawAmount !== null && amount === null) ||
    (amount === null) !== (reference === null)
    ? null
    : {
        name,
        symbol,
        equivalenceAmount: amount,
        referenceUnitPublicId: reference,
        conversionProvided,
      };
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
    convertible: unit.dimension !== null,
    dimension: unit.dimension,
    baseFactor: unit.base_factor === null ? null : displayDecimal(unit.base_factor),
    baseOffset: unit.base_offset === null ? null : displayDecimal(unit.base_offset),
    usageCount: unit.usage_count,
  };
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
function invalidUnit(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ code: 'INVALID_UNIT', error: 'The unit is invalid.' });
}
function invalidReference(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({
    code: 'INVALID_REFERENCE_UNIT',
    error: 'The reference unit must be a visible, non-temperature convertible unit.',
  });
}
function duplicateUnit(reply: FastifyReply): FastifyReply {
  return reply.code(409).send({
    code: 'UNIT_CONFLICT',
    error: 'The unit name or symbol conflicts with a visible unit.',
  });
}
function unitNotFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ code: 'UNIT_NOT_FOUND', error: 'The unit was not found.' });
}
function isUnique(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
function isNumeric(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === '22003' || error.code === '22001')
  );
}
