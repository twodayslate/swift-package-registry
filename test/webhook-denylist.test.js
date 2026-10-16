jest.mock('../models', () => ({
  sequelize: { authenticate: jest.fn(), sync: jest.fn() },
  Package: { findOne: jest.fn() }
}))
jest.mock('../lib/process', () => ({ parsePackageContext: jest.fn() }))
jest.mock('../lib/find-or-create-package', () => jest.fn())

const registerApp = require('..')
const db = require('../models')
const { parsePackageContext } = require('../lib/process')
const findOrCreatePackage = require('../lib/find-or-create-package')

beforeEach(() => jest.clearAllMocks())

async function setup () {
  const app = { log: jest.fn(), on: jest.fn() }
  await registerApp(app)
  const handler = app.on.mock.calls.find(([events]) => Array.isArray(events) && events.includes('release'))[1]
  const context = {
    payload: { repository: { id: 1, full_name: 'AIROVO/RVA' } },
    github: {
      repos: {
        getLatestRelease: jest.fn().mockResolvedValue({ data: null }),
        getContents: jest.fn().mockResolvedValue({ data: {} }),
        get: jest.fn()
      }
    }
  }
  return { app, handler, context }
}

test('webhook ingestion skips denied repositories before API or database calls', async () => {
  const { handler, context } = await setup()
  await handler(context)
  expect(context.github.repos.getLatestRelease).not.toHaveBeenCalled()
  expect(findOrCreatePackage).not.toHaveBeenCalled()
  expect(parsePackageContext).not.toHaveBeenCalled()
})

test('webhook ingestion checks the canonical repository name', async () => {
  const { handler, context } = await setup()
  context.payload.repository.full_name = 'old-owner/old-name'
  context.github.repos.get.mockResolvedValue({ data: { full_name: 'airovo/rva' } })
  await handler(context)
  expect(findOrCreatePackage).not.toHaveBeenCalled()
  expect(parsePackageContext).not.toHaveBeenCalled()
})

test('metadata updates skip denied repositories', async () => {
  const { app, context } = await setup()
  const handler = app.on.mock.calls.find(([events]) => Array.isArray(events) && events.includes('star'))[1]
  await handler(context)
  expect(context.github.repos.get).not.toHaveBeenCalled()
  expect(db.Package.findOne).not.toHaveBeenCalled()
})

test('webhook ingestion uses the shared repository lock helper', async () => {
  const { handler, context } = await setup()
  const info = { id: 1, full_name: 'owner/package' }
  context.payload.repository = info
  context.github.repos.get.mockResolvedValue({ data: info })
  const record = { info, save: jest.fn() }
  findOrCreatePackage.mockResolvedValue([record, true])
  await handler(context)
  expect(findOrCreatePackage).toHaveBeenCalledWith(db.Package, info.id, info)
  expect(parsePackageContext).toHaveBeenCalledWith(context, record)
})
