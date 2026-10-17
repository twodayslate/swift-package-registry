jest.mock('../lib/process', () => ({ parsePackageRequest: jest.fn() }))
jest.mock('async', () => ({
  queue: jest.fn(() => ({ push: jest.fn(), error: jest.fn(), drain: jest.fn(), length: jest.fn() }))
}))

const isRepositoryDenied = require('../lib/repository-denylist')
const { parsePackageRequest } = require('../lib/process')

function setup (moduleName, route, method = 'get') {
  const router = {
    get: jest.fn(),
    post: jest.fn(),
    db: { Package: { findOrCreate: jest.fn(), findOne: jest.fn() } }
  }
  require(moduleName)(router)
  const handler = router[method].mock.calls.find(([path]) => path === route)[1]
  const req = {
    params: { owner: 'AIRovo', repo: 'RVA' },
    body: { url: 'https://github.com/AIRovo/RVA.git/' },
    flash: jest.fn(),
    octokitWithPersonalAccessToken: { repos: { get: jest.fn() } }
  }
  const res = { status: jest.fn().mockReturnThis(), render: jest.fn(), redirect: jest.fn(), json: jest.fn() }
  return { router, handler, req, res }
}

beforeEach(() => jest.clearAllMocks())

test.each(['airovo/rva', 'AIROVO/RVA', 'Airovo/Rva'])('denies exact name %s case-insensitively', name => {
  expect(isRepositoryDenied(name)).toBe(true)
})

test.each(['airovo/rva-swift', 'other/rva', 'airovo/other', undefined, null])('allows other names: %s', name => {
  expect(isRepositoryDenied(name)).toBe(false)
})

test('package page rejects denied names before fetching or creating a record', async () => {
  const { router, handler, req, res } = setup('../lib/package', '/:owner/:repo')
  await handler(req, res)
  expect(res.status).toHaveBeenCalledWith(404)
  expect(req.octokitWithPersonalAccessToken.repos.get).not.toHaveBeenCalled()
  expect(router.db.Package.findOrCreate).not.toHaveBeenCalled()
  expect(parsePackageRequest).not.toHaveBeenCalled()
})

test.each(['../lib/package', '../lib/api/package'])('JSON route rejects denied names in %s', async moduleName => {
  const { router, handler, req, res } = setup(moduleName, '/:owner/:repo.json')
  await handler(req, res)
  expect(res.status).toHaveBeenCalledWith(404)
  expect(res.json).toHaveBeenCalledWith(null)
  expect(router.db.Package.findOne).not.toHaveBeenCalled()
})

test('manual submissions reject denied names before fetching or creating a record', async () => {
  const { router, handler, req, res } = setup('../lib/add', '/add', 'post')
  await handler(req, res)
  expect(req.flash).toHaveBeenCalledWith('error', 'This repository is excluded from the registry')
  expect(res.redirect).toHaveBeenCalledWith('/add')
  expect(req.octokitWithPersonalAccessToken.repos.get).not.toHaveBeenCalled()
  expect(router.db.Package.findOrCreate).not.toHaveBeenCalled()
})

test.each([
  ['../lib/add', '/add', 'post'],
  ['../lib/package', '/:owner/:repo', 'get']
])('rejects canonical denied names returned by GitHub in %s', async (moduleName, route, method) => {
  const { router, handler, req, res } = setup(moduleName, route, method)
  req.params = { owner: 'old-owner', repo: 'old-name' }
  req.body.url = 'https://github.com/old-owner/old-name'
  req.octokitWithPersonalAccessToken.repos.get.mockResolvedValue({ data: { id: 1, full_name: 'airovo/rva' } })
  await handler(req, res)
  expect(router.db.Package.findOrCreate).not.toHaveBeenCalled()
  expect(parsePackageRequest).not.toHaveBeenCalled()
})

test.each([
  ['../lib/add', '/add', 'post'],
  ['../lib/package', '/:owner/:repo', 'get']
])('allows the separate Swift repository in %s', async (moduleName, route, method) => {
  const { router, handler, req, res } = setup(moduleName, route, method)
  const info = { id: 2, full_name: 'airovo/rva-swift', name: 'rva-swift' }
  req.params = { owner: 'airovo', repo: 'rva-swift' }
  req.body.url = 'https://github.com/airovo/rva-swift'
  req.octokitWithPersonalAccessToken.repos.get.mockResolvedValue({ data: info })
  router.db.Package.findOrCreate.mockResolvedValue([{ info }, true])
  await handler(req, res)
  expect(router.db.Package.findOrCreate).toHaveBeenCalledTimes(1)
})
