jest.mock('../models', () => ({
  sequelize: { authenticate: jest.fn(), sync: jest.fn() },
  Package: { findOrCreate: jest.fn(), findOne: jest.fn() }
}))
jest.mock('../lib/process', () => ({ parsePackageContext: jest.fn() }))

const registerApp = require('..')
const db = require('../models')
const { parsePackageContext } = require('../lib/process')

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
  expect(db.Package.findOrCreate).not.toHaveBeenCalled()
  expect(parsePackageContext).not.toHaveBeenCalled()
})

test('webhook ingestion checks the canonical repository name', async () => {
  const { handler, context } = await setup()
  context.payload.repository.full_name = 'old-owner/old-name'
  context.github.repos.get.mockResolvedValue({ data: { full_name: 'airovo/rva' } })
  await handler(context)
  expect(db.Package.findOrCreate).not.toHaveBeenCalled()
  expect(parsePackageContext).not.toHaveBeenCalled()
})

test('metadata updates skip denied repositories', async () => {
  const { app, context } = await setup()
  const handler = app.on.mock.calls.find(([events]) => Array.isArray(events) && events.includes('star'))[1]
  await handler(context)
  expect(context.github.repos.get).not.toHaveBeenCalled()
  expect(db.Package.findOne).not.toHaveBeenCalled()
})
