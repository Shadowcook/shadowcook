import type { PoolClient, QueryResult } from 'pg';

interface CloneColumnRow {
  name: string;
  required: boolean;
}

export type CloneColumns = ReadonlyMap<string, boolean>;

export async function readCloneColumns(client: PoolClient, table: string): Promise<CloneColumns> {
  const result: QueryResult<CloneColumnRow> = await client.query<CloneColumnRow>(
    `SELECT attribute.attname AS name,
       attribute.attnotnull AND NOT attribute.atthasdef AND attribute.attidentity = '' AS required
     FROM pg_attribute attribute
     JOIN pg_class relation ON relation.oid = attribute.attrelid
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public' AND relation.relname = $1
       AND relation.relkind IN ('r', 'p') AND attribute.attnum > 0
       AND NOT attribute.attisdropped AND attribute.attgenerated = ''`,
    [table],
  );
  return new Map<string, boolean>(
    result.rows.map((column: CloneColumnRow): [string, boolean] => [column.name, column.required]),
  );
}

export function hasCloneColumns(columns: CloneColumns, names: string[]): boolean {
  return names.every((name: string): boolean => columns.has(name));
}

export function canInsertCloneRow(columns: CloneColumns, supplied: string[]): boolean {
  return (
    columns.size > 0 &&
    Array.from(columns).every(
      ([name, required]: [string, boolean]): boolean => !required || supplied.includes(name),
    )
  );
}

export function cloneIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function cloneAssignments(columns: CloneColumns, values: Record<string, string>): string[] {
  return Object.entries(values)
    .filter(([name]: [string, string]): boolean => columns.has(name))
    .map(
      ([name, expression]: [string, string]): string => `${cloneIdentifier(name)} = ${expression}`,
    );
}
