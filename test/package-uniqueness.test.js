const Sequelize = require('sequelize')
const definePackage = require('../models/package')

// Use a disposable schema, never sync or truncate the application's tables.
const schema = `package_uniqueness_${process.pid}_${Date.now()}`
const connection = process.env.POSTGRESQL_SERVER || 'postgres://localhost:5432/spr'
// Sequelize's PostgreSQL index discovery matches table names across schemas.
// A unique table name also isolates these checks from the app test's Packages.
const options = { logging: false, define: { schema, tableName: schema }, pool: { max: 3 } }
const first = new Sequelize(connection, options)
const second = new Sequelize(connection, options)
const Package = definePackage(first, Sequelize.DataTypes)
const OtherPackage = definePackage(second, Sequelize.DataTypes)
const indexName = 'packages_github_id_unique'

function repository (id, name = 'owner/package') {
  return { github_id: id, info: { id, full_name: name } }
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

test('concurrent ingestion returns the same row across database clients', async () => {
  let waiting = 0
  let release
  let timeout
  const bothReadsFinished = new Promise((resolve, reject) => {
    release = resolve
    timeout = setTimeout(() => reject(new Error('Both repository reads must overlap')), 3000)
  })
  const afterFind = async result => {
    if (result !== null) return
    waiting += 1
    if (waiting === 2) release()
    await bothReadsFinished
  }
  Package.addHook('afterFind', 'overlappingIngestion', afterFind)
  OtherPackage.addHook('afterFind', 'overlappingIngestion', afterFind)

  try {
    // Force both SELECTs to miss before either INSERT, rather than relying on timing.
    const results = await Promise.all([Package, OtherPackage].map(model => model.findOrCreate({
      where: { github_id: 123 },
      defaults: repository(123)
    })))

    expect(waiting).toBe(2)
    expect(results[0][0].id).toBe(results[1][0].id)
    expect(results.filter(([, created]) => created)).toHaveLength(1)
    expect(await Package.count({ where: { github_id: 123 } })).toBe(1)
  } finally {
    clearTimeout(timeout)
    release()
    Package.removeHook('afterFind', 'overlappingIngestion')
    OtherPackage.removeHook('afterFind', 'overlappingIngestion')
  }
})

test('the database rejects duplicate repository IDs outside findOrCreate', async () => {
  await Package.create(repository(123))
  await expect(OtherPackage.create(repository(123))).rejects.toBeInstanceOf(Sequelize.UniqueConstraintError)
  expect(await Package.count()).toBe(1)
})

test('different repositories remain independent', async () => {
  const results = await Promise.all([123, 456].map(id => Package.findOrCreate({
    where: { github_id: id },
    defaults: repository(id)
  })))
  expect(results.every(([, created]) => created)).toBe(true)
  expect(results[0][0].id).not.toBe(results[1][0].id)
  expect(await Package.count()).toBe(2)
})

test('renaming a repository does not create another row', async () => {
  const existing = await Package.create(repository(123, 'owner/old-name'))
  const [found, created] = await OtherPackage.findOrCreate({
    where: { github_id: 123 },
    defaults: repository(123, 'owner/new-name')
  })
  expect(created).toBe(false)
  expect(found.id).toBe(existing.id)
  expect(await Package.count()).toBe(1)
})

test('repeated startup synchronization keeps one named unique index', async () => {
  await Package.sync({ alter: true })
  await Package.sync({ alter: true })
  const indexes = await first.getQueryInterface().showIndex(Package.getTableName())
  const repositoryIndexes = indexes.filter(index => index.fields.some(field => field.attribute === 'github_id'))
  expect(repositoryIndexes).toHaveLength(1)
  expect(repositoryIndexes[0]).toMatchObject({ name: indexName, unique: true })
})

test('upgrading duplicate legacy data fails without deleting or merging records', async () => {
  await first.getQueryInterface().removeIndex(Package.getTableName(), `${schema}.${indexName}`)
  await Package.bulkCreate([
    { ...repository(123), processing: false, readme: 'Previously processed package' },
    { ...repository(123), is_installed: true }
  ])
  const before = await Package.findAll({ raw: true, order: [['id', 'ASC']] })

  await expect(Package.sync({ alter: true })).rejects.toBeInstanceOf(Sequelize.UniqueConstraintError)
  expect(await Package.findAll({ raw: true, order: [['id', 'ASC']] })).toEqual(before)
})

test('upgrading unique legacy data adds protection without changing existing rows', async () => {
  await first.getQueryInterface().removeIndex(Package.getTableName(), `${schema}.${indexName}`)
  const existing = await Package.create({ ...repository(123), processing: false })
  await Package.sync({ alter: true })
  expect((await Package.findByPk(existing.id)).toJSON()).toEqual(existing.toJSON())
  await expect(OtherPackage.create(repository(123))).rejects.toBeInstanceOf(Sequelize.UniqueConstraintError)
})

test('nullable legacy repository IDs remain unchanged', async () => {
  await Package.bulkCreate([repository(null), repository(null)])
  await Package.sync({ alter: true })
  expect(await Package.count()).toBe(2)
})
