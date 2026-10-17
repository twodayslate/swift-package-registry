const Sequelize = require('sequelize')
const definePackage = require('../models/package')
const initializeDatabase = require('../lib/initialize-database')

const schema = `package_dedupe_${process.pid}_${Date.now()}`
const connection = process.env.POSTGRESQL_SERVER || 'postgres://localhost:5432/spr'
const options = { logging: false, define: { schema, tableName: schema }, pool: { max: 3 } }
const first = new Sequelize(connection, options)
const second = new Sequelize(connection, options)
const Package = definePackage(first, Sequelize.DataTypes)
const OtherPackage = definePackage(second, Sequelize.DataTypes)
const initialize = Model => initializeDatabase({ sequelize: Model.sequelize, Package: Model })
const table = `"${schema}"."${schema}"`
const query = sql => first.query(sql, { type: Sequelize.QueryTypes.SELECT })
const snapshot = () => query(`SELECT to_jsonb(p)::text AS data FROM ${table} p ORDER BY id`)
const tables = () => query(`SELECT tablename FROM pg_tables WHERE schemaname = '${schema}' ORDER BY tablename`)

function record (id, githubId, overrides = {}) {
  return {
    id,
    github_id: githubId,
    info: { id: githubId, full_name: 'owner/package' },
    processing: false,
    error: null,
    description: { name: 'Package' },
    dump: { name: 'Package' },
    dependencies: { dependencies: [] },
    tools_version: '5.6',
    readme: 'Readme',
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2021-01-01'),
    ...overrides
  }
}

function deferred () {
  let complete
  const promise = new Promise(resolve => { complete = resolve })
  return { promise, resolve: complete }
}

async function within (promise) {
  let timer
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for test coordination')), 5000) })])
  } finally {
    clearTimeout(timer)
  }
}

async function waitForBlockedLock (pid) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const rows = await query(`SELECT 1 FROM pg_locks WHERE pid = ${Number(pid)} AND NOT granted`)
    if (rows.length) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Writer did not wait for the migration lock')
}

beforeEach(async () => {
  await first.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await first.createSchema(schema)
  await Package.sync()
})

afterAll(async () => {
  try {
    await first.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  } finally {
    await Promise.all([first.close(), second.close()])
  }
})

test('startup ranks usability, completeness, recency, then stable ID and preserves null IDs', async () => {
  await Package.bulkCreate([
    record(1, 123, { error: 'Recent failure', updatedAt: new Date('2024-01-01') }),
    record(2, 123),
    record(3, 123, { readme: null, updatedAt: new Date('2023-01-01') }),
    record(4, 456), record(5, 456, { updatedAt: new Date('2022-01-01') }),
    record(6, 789), record(7, 789),
    record(8, 999, { processing: true }),
    record(9, 999, { dump: null, readme: null }),
    record(10, 888, { description: {}, dump: {}, dependencies: {}, tools_version: '', readme: '' }),
    record(11, 888, { description: {}, dump: {}, dependencies: { dependencies: [] }, tools_version: '', readme: '' }),
    record(12, null), record(13, null), record(14, 666), record(15, 666)
  ])
  await first.query(`UPDATE ${table} SET "updatedAt" = NULL WHERE id = 14`)
  const before = await snapshot()
  const report = await initialize(Package)
  expect(report.groups.map(group => group.keepId)).toEqual([2, 5, 15, 6, 11, 9])
  expect(report.removeCount).toBe(7)
  expect(report.backupTable).not.toBeNull()
  const keep = new Set([2, 5, 6, 9, 11, 12, 13, 15])
  expect(await snapshot()).toEqual(before.filter(row => keep.has(JSON.parse(row.data).id)))
  expect((await first.getQueryInterface().showIndex(Package.getTableName())).some(item => item.name === 'packages_github_id_unique' && item.unique)).toBe(true)
})

test('startup archives exact full rows before alter-sync and enforces uniqueness', async () => {
  await Package.bulkCreate([record(1, '9223372036854775807'), record(2, '9223372036854775807', { error: 'failed' }), record(3, null), record(4, null)])
  await first.query(`ALTER TABLE ${table} ADD COLUMN extra_metadata text`)
  await first.query(`UPDATE ${table} SET extra_metadata = 'not in the model', "updatedAt" = '2022-01-01 01:02:03.123456+00' WHERE id = 2`)
  const before = await snapshot()
  const expectedSurvivors = await query(`SELECT (to_jsonb(p) - 'extra_metadata')::text AS data FROM ${table} p WHERE id <> 2 ORDER BY id`)
  const report = await initialize(Package)
  expect(report.groups[0].githubId).toBe('9223372036854775807')
  expect(report.groups[0].keepId).toBe(1)
  expect(await snapshot()).toEqual(expectedSurvivors)
  expect(await query(`SELECT (to_jsonb(b) - '_dedupe_keeper_id')::text AS data FROM ${report.backupTable} b`)).toEqual([before[1]])
  expect(await query(`SELECT _dedupe_keeper_id FROM ${report.backupTable}`)).toEqual([{ _dedupe_keeper_id: 1 }])
  await expect(Package.create(record(5, '9223372036854775807'))).rejects.toBeInstanceOf(Sequelize.UniqueConstraintError)
  await Package.create(record(6, null))
  expect(await Package.count({ where: { github_id: null } })).toBe(3)
  const afterTables = await tables()
  const again = await initialize(Package)
  expect(again.alreadyApplied).toBe(true)
  expect(again.removeCount).toBe(0)
  expect(again.backupTable).toBeNull()
  expect(await tables()).toEqual(afterTables)
})

test('actual app startup cleans duplicates before registration and repeat startup is idempotent', async () => {
  await Package.bulkCreate([record(1, 123), record(2, 123)])
  jest.doMock('../models', () => ({ sequelize: first, Package }))
  const registerApp = require('..')
  const app = { log: jest.fn(), on: jest.fn() }
  await registerApp(app)
  expect(await Package.count()).toBe(1)
  expect(app.on).toHaveBeenCalled()
  expect(app.log.mock.calls.some(([message]) => message.includes('Archived 1 duplicate'))).toBe(true)
  const beforeTables = await tables()
  await registerApp(app)
  expect(await tables()).toEqual(beforeTables)
  const report = await initialize(Package)
  expect(report.alreadyApplied).toBe(true)
  await expect(Package.create(record(3, 123))).rejects.toBeInstanceOf(Sequelize.UniqueConstraintError)
})

test('real concurrent legacy findOrCreate clients recover from the unique-insert race', async () => {
  await initialize(Package)
  const bothMissing = deferred()
  let readers = 0
  const barrier = async () => {
    if (++readers === 2) bothMissing.resolve()
    await bothMissing.promise
  }
  Package.addHook('beforeCreate', 'race', barrier)
  OtherPackage.addHook('beforeCreate', 'race', barrier)
  const find = Model => Model.findOrCreate({ where: { github_id: 123 }, defaults: { info: { id: 123 } } })
  const operations = [find(Package), find(OtherPackage)]
  try {
    const results = await within(Promise.all(operations))
    expect(readers).toBe(2)
    expect(results.map(([, created]) => created).sort()).toEqual([false, true])
    expect(results[0][0].id).toBe(results[1][0].id)
    expect(await Package.count()).toBe(1)
  } finally {
    bothMissing.resolve()
    await Promise.allSettled(operations)
    Package.removeHook('beforeCreate', 'race')
    OtherPackage.removeHook('beforeCreate', 'race')
  }
})

test('a failure after deletion rolls back cleanup, archive, and index together', async () => {
  await Package.bulkCreate([record(1, 123), record(2, 123)])
  const before = await snapshot()
  const beforeTables = await tables()
  const original = first.query.bind(first)
  const failure = new Error('Simulated index creation failure')
  const spy = jest.spyOn(first, 'query').mockImplementation((sql, opts) => {
    if (sql.startsWith('CREATE UNIQUE INDEX')) throw failure
    return original(sql, opts)
  })
  try {
    await expect(initialize(Package)).rejects.toBe(failure)
  } finally {
    spy.mockRestore()
  }
  expect(await snapshot()).toEqual(before)
  expect(await tables()).toEqual(beforeTables)
  expect((await initialize(Package)).alreadyApplied).toBe(false)
  await initialize(OtherPackage)
  expect(await Package.count()).toBe(1)
})

test('incoming cascading references are reported and refused without changing either table', async () => {
  await Package.bulkCreate([record(1, 123), record(2, 123)])
  await first.query(`CREATE TABLE "${schema}".child (package_id integer REFERENCES ${table}(id) ON DELETE CASCADE)`)
  await first.query(`INSERT INTO "${schema}".child VALUES (2)`)
  const before = await snapshot()
  await expect(initialize(Package)).rejects.toThrow('Incoming foreign keys')
  expect(await snapshot()).toEqual(before)
  expect(await query(`SELECT * FROM "${schema}".child`)).toEqual([{ package_id: 2 }])
})

test.each([
  ['row-level security', `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, 'Row-level security'],
  ['inheritance', `CREATE TABLE "${schema}".child () INHERITS (${table})`, 'inherited'],
  ['delete trigger', `CREATE FUNCTION "${schema}".reject_delete() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''must not fire''; END'; CREATE TRIGGER refuse_delete BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_delete()`, 'triggers or rules']
])('%s requires explicit review, rather than silently deleting', async (name, setup, message) => {
  await Package.bulkCreate([record(1, 123), record(2, 123)])
  await first.query(setup)
  await expect(initialize(Package)).rejects.toThrow(message)
  expect(await Package.count()).toBe(2)
})

test.each([
  `CREATE INDEX packages_github_id_unique ON ${table} (github_id)`,
  `CREATE UNIQUE INDEX packages_github_id_unique ON ${table} (github_id) WHERE github_id > 0`,
  `CREATE UNIQUE INDEX packages_github_id_unique ON ${table} (id)`,
  `CREATE UNIQUE INDEX packages_github_id_unique ON ${table} (github_id) NULLS NOT DISTINCT`,
  `ALTER TABLE ${table} ADD CONSTRAINT packages_github_id_unique UNIQUE (github_id) DEFERRABLE`
])('rejects a non-equivalent existing index: %s', async setup => {
  await first.query(setup)
  await expect(initialize(Package)).rejects.toThrow('not the expected')
})

test('writers wait until cleanup and index commit, then duplicates are rejected', async () => {
  await Package.bulkCreate([record(1, 123), record(2, 123)])
  const beforeIndex = deferred()
  const release = deferred()
  const writerStarted = deferred()
  const original = first.query.bind(first)
  const spy = jest.spyOn(first, 'query').mockImplementation(async (sql, opts) => {
    if (sql.startsWith('CREATE UNIQUE INDEX')) {
      beforeIndex.resolve()
      await release.promise
    }
    return original(sql, opts)
  })
  const operations = []
  try {
    operations.push(initialize(Package))
    await within(Promise.race([beforeIndex.promise, operations[0]]))
    operations.push(second.transaction(async transaction => {
      writerStarted.resolve(transaction.connection.processID)
      await OtherPackage.create(record(3, 123), { transaction })
    }).then(result => ({ result }), error => ({ error })))
    await waitForBlockedLock(await within(writerStarted.promise))
    release.resolve()
    await within(operations[0])
    const result = await within(operations[1])
    expect(result.error).toBeInstanceOf(Sequelize.UniqueConstraintError)
    expect(await Package.count()).toBe(1)
  } finally {
    release.resolve()
    await Promise.allSettled(operations)
    spy.mockRestore()
  }
})

test('a blocked delete times out and rolls back its archive and changes', async () => {
  await Package.bulkCreate([record(1, 123), record(2, 123)])
  const held = deferred()
  const release = deferred()
  const before = await snapshot()
  const beforeTables = await tables()
  const holding = second.transaction(async transaction => {
    await second.query(`SELECT id FROM ${table} WHERE id = 2 FOR UPDATE`, { transaction })
    held.resolve()
    await release.promise
  })
  try {
    await within(held.promise)
    await expect(initialize(Package)).rejects.toMatchObject({ original: { code: '55P03' } })
  } finally {
    release.resolve()
    await holding
  }
  expect(await snapshot()).toEqual(before)
  expect(await tables()).toEqual(beforeTables)
  await OtherPackage.create(record(3, 456))
}, 15000)

test('a final schema-sync failure rolls back cleanup, archive, and index and prevents registration', async () => {
  await Package.bulkCreate([record(1, 123), record(2, 123)])
  const before = await snapshot()
  const beforeTables = await tables()
  const original = first.sync.bind(first)
  const failure = new Error('Final schema sync failed')
  const spy = jest.spyOn(first, 'sync').mockImplementation(opts => {
    if (opts.alter === true) throw failure
    return original(opts)
  })
  const registerApp = require('..')
  const app = { log: jest.fn(), on: jest.fn() }
  try {
    await expect(registerApp(app)).rejects.toBe(failure)
  } finally {
    spy.mockRestore()
  }
  expect(app.on).not.toHaveBeenCalled()
  expect(await snapshot()).toEqual(before)
  expect(await tables()).toEqual(beforeTables)
  expect((await first.getQueryInterface().showIndex(Package.getTableName())).some(item => item.name === 'packages_github_id_unique')).toBe(false)
})

test.each([false, true])('concurrent startup is serialized for a database with duplicates=%s', async dirty => {
  if (dirty) await Package.bulkCreate([record(1, 123), record(2, 123)])
  else await Package.drop()
  const firstSync = deferred()
  const release = deferred()
  const secondLock = deferred()
  const originalSync = first.sync.bind(first)
  const syncSpy = jest.spyOn(first, 'sync').mockImplementation(async opts => {
    if (opts.alter !== true) {
      firstSync.resolve()
      await release.promise
    }
    return originalSync(opts)
  })
  const originalQuery = second.query.bind(second)
  const querySpy = jest.spyOn(second, 'query').mockImplementation((sql, opts) => {
    const result = originalQuery(sql, opts)
    if (typeof sql === 'string' && sql.includes('pg_advisory_xact_lock')) secondLock.resolve(opts.transaction.connection.processID)
    return result
  })
  const operations = []
  try {
    operations.push(initialize(Package))
    await within(Promise.race([firstSync.promise, operations[0]]))
    operations.push(initialize(OtherPackage))
    const pid = await within(Promise.race([secondLock.promise, operations[1]]))
    await waitForBlockedLock(pid)
    release.resolve()
    const reports = await within(Promise.all(operations))
    expect(reports.map(report => report.alreadyApplied)).toEqual([false, true])
    expect(reports[1].backupTable).toBeNull()
    expect(await Package.count()).toBe(dirty ? 1 : 0)
    expect((await tables()).filter(row => row.tablename.startsWith('package_duplicate_backup_'))).toHaveLength(dirty ? 1 : 0)
  } finally {
    release.resolve()
    await Promise.allSettled(operations)
    syncSpy.mockRestore()
    querySpy.mockRestore()
  }
})

test('an existing valid index permits restarts without deleting referenced rows', async () => {
  await Package.create(record(1, 123))
  await initialize(Package)
  await first.query(`CREATE TABLE "${schema}".child (package_id integer REFERENCES ${table}(id))`)
  await first.query(`INSERT INTO "${schema}".child VALUES (1)`)
  const before = await snapshot()
  const report = await initialize(OtherPackage)
  expect(report.alreadyApplied).toBe(true)
  expect(report.backupTable).toBeNull()
  expect(await snapshot()).toEqual(before)
  expect(await query(`SELECT * FROM "${schema}".child`)).toEqual([{ package_id: 1 }])
})
