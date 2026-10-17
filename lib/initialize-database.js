const { randomUUID } = require('crypto')
const { QueryTypes, Transaction } = require('sequelize')

const indexName = 'packages_github_id_unique'

module.exports = async function initializeDatabase (db) {
  return db.sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async transaction => {
    const execute = sql => db.sequelize.query(sql, { transaction })
    // Serialize the entire schema initialization, including first-time table
    // creation, across app processes. No session lock can leak into the pool.
    await execute("SET LOCAL lock_timeout = '5min'")
    await execute("SET LOCAL statement_timeout = '5min'")
    await execute("SELECT pg_advisory_xact_lock(hashtext('swift-package-registry'), hashtext('initialize-database'))")
    await execute("SET LOCAL lock_timeout = '5s'")
    await execute('SET LOCAL row_security = off')
    // Add required columns first, but archive duplicates before the existing
    // alter-sync behavior can drop columns unknown to this app version.
    await db.sequelize.sync({ alter: { drop: false }, transaction })
    const report = await ensurePackageUniqueness(db.Package, transaction)
    await db.sequelize.sync({ alter: true, transaction })
    return report
  })
}

async function ensurePackageUniqueness (Package, transaction) {
  const sequelize = Package.sequelize
  const generator = sequelize.getQueryInterface().queryGenerator
  const quote = name => generator.quoteIdentifier(name)
  const table = generator.quoteTable(Package.getTableName())
  const execute = (sql, bind) => sequelize.query(sql, { bind, transaction })
  const select = (sql, bind) => sequelize.query(sql, { bind, transaction, type: QueryTypes.SELECT })
  // Block all writers until archival, cleanup, and index creation commit.
  await execute(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`)
  const [relation] = await select(`
    SELECT c.oid, n.nspname AS schema, c.relkind, c.relrowsecurity,
      EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid = c.oid OR inhparent = c.oid) AS inherited,
      EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = c.oid AND attname = '_dedupe_keeper_id' AND NOT attisdropped) AS reserved_column
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid = to_regclass($1)`, [table])
  if (!relation) throw new Error(`Package table does not exist: ${table}. Initialize the application schema first.`)

  const foreignKeys = await select(`
    SELECT conname AS name, conrelid::regclass::text AS referencing_table
    FROM pg_constraint WHERE contype = 'f' AND confrelid = $1 ORDER BY conname`, [relation.oid])
  const triggers = await select('SELECT tgname AS name FROM pg_trigger WHERE tgrelid = $1 AND NOT tgisinternal ORDER BY tgname', [relation.oid])
  const rules = await select('SELECT rulename AS name FROM pg_rewrite WHERE ev_class = $1 ORDER BY rulename', [relation.oid])
  const blockers = []
  if (relation.relkind !== 'r' || relation.inherited) blockers.push('Partitioned or inherited tables require a custom migration')
  if (relation.relrowsecurity) blockers.push('Row-level security requires a custom migration')
  if (relation.reserved_column) blockers.push('Reserved archive column _dedupe_keeper_id already exists')
  if (foreignKeys.length) blockers.push('Incoming foreign keys must be reconciled explicitly; this migration never cascades or rewrites references')
  if (triggers.length || rules.length) blockers.push('User triggers or rules require review before deleting rows')

  const [existingIndex] = await select(`
    SELECT c.relname,
      COALESCE(i.indrelid = $1 AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
        AND i.indnatts = 1 AND i.indexprs IS NULL AND i.indpred IS NULL
        AND i.indkey::text = a.attnum::text
        AND NOT COALESCE((to_jsonb(i)->>'indnullsnotdistinct')::boolean, false), false) AS compatible
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_index i ON i.indexrelid = c.oid
    LEFT JOIN pg_attribute a ON a.attrelid = $1 AND a.attname = 'github_id' AND NOT a.attisdropped
    WHERE n.nspname = $2 AND c.relname = $3`, [relation.oid, relation.schema, indexName])
  if (existingIndex && !existingIndex.compatible) blockers.push(`Existing ${indexName} is not the expected valid, immediate, nonpartial unique index`)
  // An already-valid index needs no cleanup; ordinary restarts may have
  // references or triggers introduced after the migration.
  if (existingIndex && existingIndex.compatible && relation.relkind === 'r' && !relation.inherited && !relation.relrowsecurity) {
    return { table, index: indexName, alreadyApplied: true, removeCount: 0, groups: [], backupTable: null }
  }

  // A null GitHub ID does not identify a repository, so never group nulls.
  // Score useful fields, not JSON/README byte size. Empty dependencies are valid
  // when represented by the usual object containing a dependencies array.
  const populated = field => `(jsonb_typeof(${quote(field)}) = 'object' AND ${quote(field)} <> '{}'::jsonb)`
  const description = populated('description')
  const dump = populated('dump')
  const dependencies = populated('dependencies')
  const ranked = `WITH scored AS (
    SELECT id, github_id, "updatedAt",
      COALESCE(processing = false AND error IS NULL AND (${description} OR ${dump}), false) AS usable,
      (CASE WHEN ${description} THEN 1 ELSE 0 END + CASE WHEN ${dump} THEN 1 ELSE 0 END +
       CASE WHEN ${dependencies} THEN 1 ELSE 0 END +
       CASE WHEN NULLIF(BTRIM(tools_version), '') IS NOT NULL THEN 1 ELSE 0 END +
       CASE WHEN NULLIF(BTRIM(readme), '') IS NOT NULL THEN 1 ELSE 0 END) AS completeness
    FROM ${table} WHERE github_id IS NOT NULL
  ), ranked AS (
    SELECT *, ROW_NUMBER() OVER repository AS position, FIRST_VALUE(id) OVER repository AS keeper_id,
      COUNT(*) OVER (PARTITION BY github_id) AS group_size
    FROM scored WINDOW repository AS
      (PARTITION BY github_id ORDER BY usable DESC, completeness DESC, "updatedAt" DESC NULLS LAST, id ASC)
  )`
  if (blockers.length) throw new Error(`Migration refused: ${blockers.join('; ')}; references: ${JSON.stringify(foreignKeys)}`)
  const candidates = await select(`${ranked} SELECT id, github_id, keeper_id, usable, completeness, "updatedAt"
        FROM ranked WHERE group_size > 1 ORDER BY github_id, position`)
  const groups = []
  for (const candidate of candidates) {
    if (candidate.id === candidate.keeper_id) {
      groups.push({ githubId: candidate.github_id, keepId: candidate.id, usable: candidate.usable, completeness: candidate.completeness, updatedAt: candidate.updatedAt, removeIds: [] })
    } else {
      groups[groups.length - 1].removeIds.push(candidate.id)
    }
  }
  const removeCount = groups.reduce((count, group) => count + group.removeIds.length, 0)
  const report = { table, index: indexName, alreadyApplied: !!(existingIndex && existingIndex.compatible), removeCount, groups, foreignKeys, triggers, rules, blockers, backupTable: null }

  if (removeCount) {
    const runId = randomUUID().replace(/-/g, '')
    const mapping = quote(`package_duplicate_ids_${runId}`)
    const backup = `${quote(relation.schema)}.${quote(`package_duplicate_backup_${runId}`)}`
    await execute(`CREATE TEMP TABLE ${mapping} ON COMMIT DROP AS ${ranked} SELECT id, keeper_id FROM ranked WHERE position > 1`)
    // Copy server-side to preserve all column values/types, including fields
    // unknown to this application version. The archive has no delete cascades.
    await execute(`CREATE TABLE ${backup} AS SELECT p.*, d.keeper_id AS _dedupe_keeper_id FROM ${table} p JOIN ${mapping} d ON p.id = d.id`)
    const [archived] = await select(`SELECT COUNT(*)::integer AS count FROM ${backup}`)
    if (archived.count !== removeCount) throw new Error('Archive count did not match the duplicate plan')
    const [deleted] = await select(`WITH deleted AS (DELETE FROM ${table} p USING ${mapping} d WHERE p.id = d.id RETURNING p.id) SELECT COUNT(*)::integer AS count FROM deleted`)
    if (deleted.count !== removeCount) throw new Error('Deleted count did not match the archived rows')
    report.backupTable = backup
  }
  // Not CONCURRENTLY: cleanup and enforcement must succeed or roll back
  // together, with no interval in which another writer can add a duplicate.
  await execute(`CREATE UNIQUE INDEX ${quote(indexName)} ON ${table} (github_id)`)
  return report
}
