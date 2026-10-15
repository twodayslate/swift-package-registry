jest.mock('dockerode', () => jest.fn(() => ({ ping: jest.fn() })))
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }))

const Docker = require('dockerode')
const { Octokit } = require('@octokit/rest')
const processors = require('../lib/process')
const docker = Docker.mock.results[0].value

beforeEach(() => jest.clearAllMocks())

test.each(['parsePackageRequest', 'parsePackageContext', 'parsePackageRobot'])('%s skips existing denied records before GitHub or Docker access', async method => {
  const record = { info: { full_name: 'AIROVO/RVA' }, save: jest.fn() }
  await expect(processors[method]({}, record)).resolves.toBe(record)
  expect(Octokit).not.toHaveBeenCalled()
  expect(docker.ping).not.toHaveBeenCalled()
  expect(record.save).not.toHaveBeenCalled()
})

test('skips a legacy denied record without info', async () => {
  const record = { full_name: 'airovo/rva', save: jest.fn() }
  await expect(processors.parsePackageRobot({}, record)).resolves.toBe(record)
  expect(Octokit).not.toHaveBeenCalled()
  expect(record.save).not.toHaveBeenCalled()
})

test.each([
  { info: { full_name: 'old-owner/old-name' } },
  { full_name: 'old-owner/old-name' }
])('checks canonical names before processing stale or legacy records: %j', async fields => {
  const get = jest.fn().mockResolvedValue({ data: { full_name: 'airovo/rva' } })
  Octokit.mockImplementation(() => ({ repos: { get } }))
  const record = { ...fields, save: jest.fn() }
  await expect(processors.parsePackageRobot({}, record)).resolves.toBe(record)
  expect(get).toHaveBeenCalledWith({ owner: 'old-owner', repo: 'old-name' })
  expect(docker.ping).not.toHaveBeenCalled()
  expect(record.save).not.toHaveBeenCalled()
})

test('continues to Docker for the separate Swift repository', async () => {
  const info = { full_name: 'airovo/rva-swift' }
  const get = jest.fn().mockResolvedValue({ data: info })
  Octokit.mockImplementation(() => ({ repos: { get } }))
  const stop = new Error('Stop before starting Docker in this unit test')
  docker.ping.mockRejectedValueOnce(stop)
  await expect(processors.parsePackageRobot({}, { info })).rejects.toBe(stop)
  expect(get).toHaveBeenCalledWith({ owner: 'airovo', repo: 'rva-swift' })
  expect(docker.ping).toHaveBeenCalledTimes(1)
})
