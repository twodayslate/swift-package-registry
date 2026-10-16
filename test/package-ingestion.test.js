const Sequelize = require('sequelize')
const definePackage = require('../models/package')
const findOrCreatePackage = require('../lib/find-or-create-package')

// Isolate both the schema and table name from the application and other suites.
const schema = `package_ingestion_${process.pid}_${Date.now()}`
const connection = process.env.POSTGRESQL_SERVER || 'postgres://localhost:5432/spr'
const options = {
  logging: false,
  define: { schema, tableName: schema },
  pool: { max: 3 },
  // The helper must override this to see commits after waiting for its lock.
  isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.REPEATABLE_READ
}
const first = new Sequelize(connection, options)
const second = new Sequelize(connection, options)
const Package = definePackage(first, Sequelize.DataTypes)
const OtherPackage = definePackage(second, Sequelize.DataTypes)

function repository (id) {
  return { id, full_name: 'owner/package' }
}

function deferred () {
  let complete
  const promise = new Promise(resolve => { complete = resolve })
  return { promise, resolve: complete }
}

async function within (promise) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for repository transaction')), 5000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function waitForBlockedLock (pid) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const rows = await first.query(
      "SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted",
      { bind: [pid], type: Sequelize.QueryTypes.SELECT }
    )
    if (rows.length) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('The second client did not wait for the repository lock')
}

beforeAll(async () => {
  await first.createSchema(schema)
})

beforeEach(async () => {
  await Package.sync({ force: true })
})

afterAll(async () => {
  try {
    await first.dropSchema(schema)
  } finally {
    await Promise.all([first.close(), second.close()])
  }
})

test.each([
  [123, '00123'],
  ['9223372036854775807', '09223372036854775807'],
  [null, null]
])('concurrent clients serialize equivalent IDs %s and %s without a unique index', async (firstId, secondId) => {
  const firstRead = deferred()
  const releaseFirst = deferred()
  const secondLock = deferred()
  const operations = []
  Package.addHook('afterFind', 'holdFirstReader', async (result, queryOptions) => {
    const isolation = await first.query('SHOW transaction_isolation', {
      transaction: queryOptions.transaction,
      type: Sequelize.QueryTypes.SELECT
    })
    expect(isolation[0].transaction_isolation).toBe('read committed')
    firstRead.resolve()
    await releaseFirst.promise
  })
  const originalQuery = second.query.bind(second)
  const query = jest.spyOn(second, 'query').mockImplementation((sql, queryOptions) => {
    const result = originalQuery(sql, queryOptions)
    if (typeof sql === 'string' && sql.includes('pg_advisory_xact_lock')) {
      secondLock.resolve(queryOptions.transaction.connection.processID)
    }
    return result
  })

  try {
    operations.push(findOrCreatePackage(Package, firstId, repository(firstId)))
    await within(Promise.race([firstRead.promise, operations[0]]))
    operations.push(findOrCreatePackage(OtherPackage, secondId, repository(secondId)))
    const pid = await within(Promise.race([secondLock.promise, operations[1]]))
    await waitForBlockedLock(pid)
    releaseFirst.resolve()

    const results = await within(Promise.all(operations))
    expect(results[0][0].id).toBe(results[1][0].id)
    expect(results.map(([, created]) => created)).toEqual([true, false])
    expect(await OtherPackage.count()).toBe(1)
  } finally {
    releaseFirst.resolve()
    await Promise.allSettled(operations)
    Package.removeHook('afterFind', 'holdFirstReader')
    query.mockRestore()
  }
}, 15000)

test('existing duplicates survive app startup and use the lowest package ID', async () => {
  await Package.bulkCreate([
    { id: 20, github_id: 123, info: repository(123), is_installed: true },
    { id: 10, github_id: 123, info: repository(123), processing: false, readme: 'Existing result' },
    { id: 40, github_id: null, info: repository(null) },
    { id: 30, github_id: null, info: repository(null), processing: false }
  ])
  const before = await Package.findAll({ raw: true, order: [['id', 'ASC']] })

  jest.doMock('../models', () => ({ sequelize: first, Package }))
  const registerApp = require('..')
  const app = { log: jest.fn(), on: jest.fn() }
  await registerApp(app)
  expect(app.on).toHaveBeenCalled()
  await first.sync({ alter: true })
  const results = await Promise.all([
    findOrCreatePackage(Package, 123, repository(123)),
    findOrCreatePackage(OtherPackage, '123', repository('123')),
    findOrCreatePackage(OtherPackage, null, repository(null))
  ])

  expect(results.map(([record]) => record.id)).toEqual([10, 10, 30])
  expect(results.every(([, created]) => !created)).toBe(true)
  expect(await Package.findAll({ raw: true, order: [['id', 'ASC']] })).toEqual(before)
  const indexes = await first.getQueryInterface().showIndex(Package.getTableName())
  expect(indexes.some(index => index.unique && index.fields.some(field => field.attribute === 'github_id'))).toBe(false)
})

test('a different repository can be created while another repository lock is held', async () => {
  const firstRead = deferred()
  const releaseFirst = deferred()
  const operations = []
  Package.addHook('afterFind', 'holdFirstReader', async () => {
    firstRead.resolve()
    await releaseFirst.promise
  })
  try {
    operations.push(findOrCreatePackage(Package, 123, repository(123)))
    await within(Promise.race([firstRead.promise, operations[0]]))
    operations.push(findOrCreatePackage(OtherPackage, 456, repository(456)))
    const [other, created] = await within(operations[1])
    expect(other.github_id).toBe('456')
    expect(created).toBe(true)
  } finally {
    releaseFirst.resolve()
    await Promise.allSettled(operations)
    Package.removeHook('afterFind', 'holdFirstReader')
  }
  expect(await Package.count()).toBe(2)
})

test('legacy findOrCreate callers bypass the lock during a mixed-version rollout', async () => {
  const firstRead = deferred()
  const releaseFirst = deferred()
  const operations = []
  Package.addHook('afterFind', 'holdFirstReader', async () => {
    firstRead.resolve()
    await releaseFirst.promise
  })
  try {
    operations.push(findOrCreatePackage(Package, 123, repository(123)))
    await within(Promise.race([firstRead.promise, operations[0]]))
    operations.push(OtherPackage.findOrCreate({
      where: { github_id: 123 },
      defaults: { github_id: 123, info: repository(123) }
    }))
    const [, created] = await within(operations[1])
    expect(created).toBe(true)
  } finally {
    releaseFirst.resolve()
    await Promise.allSettled(operations)
    Package.removeHook('afterFind', 'holdFirstReader')
  }
  // The old writer does not participate in the lock, so both can still insert.
  expect(await Package.count()).toBe(2)
})

test('an insert failure rolls back the row and releases the repository lock', async () => {
  const failure = new Error('Fail after inserting but before committing')
  Package.addHook('afterCreate', 'failInsert', () => { throw failure })
  try {
    await expect(findOrCreatePackage(Package, 123, repository(123))).rejects.toBe(failure)
  } finally {
    Package.removeHook('afterCreate', 'failInsert')
  }
  expect(await Package.count()).toBe(0)
  const [record, created] = await within(findOrCreatePackage(OtherPackage, 123, repository(123)))
  expect(record.github_id).toBe('123')
  expect(created).toBe(true)
})

test('a lookup failure releases the repository lock', async () => {
  const failure = new Error('Fail during lookup')
  Package.addHook('beforeFind', 'failLookup', () => { throw failure })
  try {
    await expect(findOrCreatePackage(Package, 123, repository(123))).rejects.toBe(failure)
  } finally {
    Package.removeHook('beforeFind', 'failLookup')
  }
  const [, created] = await within(findOrCreatePackage(OtherPackage, 123, repository(123)))
  expect(created).toBe(true)
})

test('large bigint IDs remain distinct without JavaScript number conversion', async () => {
  const ids = ['9223372036854775806', '9223372036854775807']
  const results = await Promise.all(ids.map(id => findOrCreatePackage(Package, id, repository(id))))
  expect(results.map(([record]) => record.github_id)).toEqual(ids)
  expect(results.every(([, created]) => created)).toBe(true)
  expect(await Package.count()).toBe(2)
})

test.each([undefined, 'not-a-repository-id'])('invalid ID %s fails instead of bypassing the lock', async id => {
  await expect(findOrCreatePackage(Package, id, repository(id))).rejects.toThrow()
  expect(await Package.count()).toBe(0)
  const [, created] = await within(findOrCreatePackage(OtherPackage, 123, repository(123)))
  expect(created).toBe(true)
})
