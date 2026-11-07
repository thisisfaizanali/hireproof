import { prisma } from "../src/db";

// Every text, varchar, json and text-array column of every table, read from the
// catalogue so a table added later is covered without touching this file.
export async function textColumns() {
  return prisma.$queryRaw<
    { table_schema: string; table_name: string; column_name: string }[]
  >`
    SELECT c.table_schema, c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE t.table_type = 'BASE TABLE'
      AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
      AND (
        c.data_type IN ('text', 'character varying', 'json', 'jsonb')
        OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar'))
      )
  `;
}

// The "table.column" of every place any of the needles appears, ignoring case.
export async function findLeaks(needles: string[]) {
  const hits: string[] = [];
  for (const col of await textColumns()) {
    for (const needle of needles) {
      const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "${col.table_schema}"."${col.table_name}"
         WHERE position(lower($1) in lower("${col.column_name}"::text)) > 0`,
        needle,
      );
      if (rows[0].n > 0) hits.push(`${col.table_name}.${col.column_name}`);
    }
  }
  return [...new Set(hits)].sort();
}
