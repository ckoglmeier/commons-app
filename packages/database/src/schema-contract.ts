import { createHash } from "node:crypto";
import type postgres from "postgres";

type CatalogRow = Record<string, unknown>;

export type SchemaContract = {
  tables: CatalogRow[];
  columns: CatalogRow[];
  constraints: CatalogRow[];
  indexes: CatalogRow[];
  enums: CatalogRow[];
  policies: CatalogRow[];
  functions: CatalogRow[];
  triggers: CatalogRow[];
  storageBuckets: CatalogRow[];
  access?: CatalogRow[];
};

function normalizedRows(rows: readonly CatalogRow[]) {
  return rows
    .map((row) => Object.fromEntries(
      Object.entries(row)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, value]),
    ))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function normalizeSchemaContract(contract: SchemaContract): SchemaContract {
  // PostgreSQL can renumber enum sort positions during dump/restore. Preserve
  // label order, not the incidental (sometimes fractional) catalog numbers.
  const positions = new Map<string, number>();
  const enums = [...contract.enums].sort((a, b) => String(a.enum_name).localeCompare(String(b.enum_name)) || Number(a.position) - Number(b.position))
    .map(row => {
      const name = String(row.enum_name), position = (positions.get(name) ?? 0) + 1;
      positions.set(name, position);
      return { ...row, position };
    });
  return Object.fromEntries(
    Object.entries({ ...contract, enums }).map(([key, rows]) => [key, normalizedRows(rows)]),
  ) as SchemaContract;
}

export function schemaContractFingerprint(contract: SchemaContract) {
  return createHash("sha256")
    .update(JSON.stringify(normalizeSchemaContract(contract)))
    .digest("hex");
}

// Only the completed 0031 legacy reconciliation uses the original inventory.
// New release contracts preserve SQL literals and include security behavior.
export function legacySchemaContractFingerprint(contract: SchemaContract) {
  const omit = (row: CatalogRow, fields: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));
  const legacy = omit(contract, ["access"]) as SchemaContract;
  legacy.tables = legacy.tables.map(row => omit(row, ["owner"]));
  legacy.functions = legacy.functions.map(row => omit(row, ["definition", "owner", "configuration"]));
  const normalized = Object.fromEntries(Object.entries(legacy).map(([key, rows]) => [key,
    rows.map((row) => Object.fromEntries(Object.entries(row).map(([name, value]) => [name,
      typeof value === "string" ? value.replace(/\s+/g, " ").trim() : value,
    ]))),
  ])) as SchemaContract;
  // Exact original algorithm, including the old physical enum sort positions.
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(
    Object.entries(normalized).map(([key, rows]) => [key, normalizedRows(rows)]),
  ))).digest("hex");
}

export async function readSchemaContract(client: postgres.Sql): Promise<SchemaContract> {
  const tables = await client.unsafe<CatalogRow[]>(`
      SELECT c.relname AS table_name, c.relrowsecurity AS row_security,
             c.relforcerowsecurity AS force_row_security, pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname
    `);
  const columns = await client.unsafe<CatalogRow[]>(`
      SELECT c.relname AS table_name, a.attnum AS position, a.attname AS column_name,
             pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
             a.attnotnull AS not_null,
             pg_get_expr(d.adbin, d.adrelid) AS column_default,
             a.attidentity AS identity_kind
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum
    `);
  const constraints = await client.unsafe<CatalogRow[]>(`
      SELECT c.relname AS table_name, con.conname AS constraint_name,
             con.contype AS constraint_type,
             pg_get_constraintdef(con.oid, true) AS definition
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      ORDER BY c.relname, con.conname
    `);
  const indexes = await client.unsafe<CatalogRow[]>(`
      SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `);
  const enums = await client.unsafe<CatalogRow[]>(`
      SELECT t.typname AS enum_name, e.enumsortorder AS position, e.enumlabel AS value
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      ORDER BY t.typname, e.enumsortorder
    `);
  const policies = await client.unsafe<CatalogRow[]>(`
      SELECT schemaname AS schema_name, tablename AS table_name, policyname AS policy_name,
             permissive, roles, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
         OR (schemaname = 'storage' AND policyname LIKE 'commons_%')
      ORDER BY schemaname, tablename, policyname
    `);
  const functions = await client.unsafe<CatalogRow[]>(`
      SELECT p.proname AS function_name,
             pg_get_function_identity_arguments(p.oid) AS arguments,
             pg_get_function_result(p.oid) AS result,
             p.provolatile AS volatility, p.prosecdef AS security_definer,
             pg_get_functiondef(p.oid) AS definition,
             pg_get_userbyid(p.proowner) AS owner, p.proconfig AS configuration
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        -- Supabase installs this database-level event-trigger helper outside
        -- the Commons migration journal. It is platform infrastructure, not
        -- part of the application schema contract.
        AND p.proname <> 'rls_auto_enable'
      ORDER BY p.proname, arguments
    `);
  const triggers = await client.unsafe<CatalogRow[]>(`
      SELECT c.relname AS table_name, t.tgname AS trigger_name,
             pg_get_triggerdef(t.oid, true) AS definition
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
      ORDER BY c.relname, t.tgname
    `);
  const storageBuckets = await client.unsafe<CatalogRow[]>(`
      SELECT id, name, public, file_size_limit, allowed_mime_types
      FROM storage.buckets
      WHERE id IN ('commons-moments', 'commons-confirmations')
      ORDER BY id
    `);
  const access = await client.unsafe<CatalogRow[]>(`
    SELECT 'table' AS kind, c.relname AS object_name, pg_get_userbyid(c.relowner) AS owner,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
           a.privilege_type, a.is_grantable, NULL::text AS column_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
      AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated'))
    UNION ALL
    SELECT 'column', c.relname, pg_get_userbyid(c.relowner),
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
           a.privilege_type, a.is_grantable, att.attname
    FROM pg_attribute att JOIN pg_class c ON c.oid = att.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(att.attacl) a
    WHERE n.nspname = 'public' AND att.attnum > 0
      AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated'))
    UNION ALL
    SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
           pg_get_userbyid(p.proowner),
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
           a.privilege_type, a.is_grantable, NULL::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'public' AND p.proname <> 'rls_auto_enable'
      AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated'))
    UNION ALL
    SELECT 'default', d.defaclobjtype::text, pg_get_userbyid(d.defaclrole),
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
           a.privilege_type, a.is_grantable, NULL::text
    FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE n.nspname = 'public' AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated'))
    UNION ALL
    SELECT 'global_default', kinds.kind::text, r.rolname,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
           a.privilege_type, a.is_grantable, NULL::text
    FROM pg_roles r CROSS JOIN (VALUES ('r'::"char"), ('S'::"char"), ('f'::"char")) kinds(kind)
    LEFT JOIN pg_default_acl d ON d.defaclrole = r.oid AND d.defaclnamespace = 0 AND d.defaclobjtype = kinds.kind
    CROSS JOIN LATERAL aclexplode(coalesce(d.defaclacl, acldefault(kinds.kind, r.oid))) a
    WHERE r.rolname = current_user
      AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated'))
  `);

  return {
    tables,
    columns,
    constraints,
    indexes,
    enums,
    policies,
    functions,
    triggers,
    storageBuckets,
    access,
  };
}

export function schemaContractSummary(contract: SchemaContract) {
  return Object.fromEntries(
    Object.entries(contract).map(([key, rows]) => [key, rows.length]),
  );
}
