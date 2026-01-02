jest.mock('@muhgholy/search-query-parser', () => ({
  parse: jest.fn()
}))

const Sequelize = require('sequelize')
const { parse } = require('@muhgholy/search-query-parser')
const registerSearch = require('../lib/search')

function buildRouter () {
  const SequelizeModule = Sequelize
  const Package = { findAll: jest.fn().mockResolvedValue([]) }
  const sequelize = {
    json: jest.fn((value) => ({ json: value })),
    cast: jest.fn((value, type) => ({ cast: value, type })),
    where: jest.fn((left, right) => ({ left, right }))
  }

  const router = {
    db: { Sequelize: SequelizeModule, sequelize, Package },
    get: jest.fn()
  }

  registerSearch(router)

  const handler = router.get.mock.calls[0][1]
  return { handler, Package, sequelize, Sequelize: SequelizeModule }
}

test('builds advanced search conditions for multiple terms, tags, and negation', async () => {
  const afterDate = new Date('2024-01-01T00:00:00.000Z')
  parse.mockReturnValue([
    { type: 'text', value: 'networking', negated: false },
    { type: 'text', value: 'cache', negated: false },
    { type: 'label', value: 'swiftui', negated: false },
    { type: 'text', value: 'beta', negated: true },
    { type: 'stars', value: '>500', negated: false, size: { op: 'gt', bytes: 500 } },
    { type: 'after', value: '2024-01-01', negated: false, date: afterDate }
  ])

  const { handler, Package, Sequelize, sequelize } = buildRouter()
  const req = { query: { term: 'networking cache topic:swiftui -beta stars:>500 after:2024-01-01' } }
  const res = { render: jest.fn() }

  await handler(req, res)

  expect(parse).toHaveBeenCalledWith(
    'networking cache label:swiftui -beta stars:>500 after:2024-01-01',
    expect.objectContaining({
      operators: [expect.objectContaining({ name: 'stars' })]
    })
  )
  expect(Package.findAll).toHaveBeenCalledTimes(1)

  const where = Package.findAll.mock.calls[0][0].where
  const { Op } = Sequelize

  expect(where.processing).toBe(false)
  expect(where[Op.and]).toHaveLength(6)

  const textConditions = where[Op.and].filter((condition) => condition[Op.or])
  expect(textConditions).toHaveLength(2)

  const negatedCondition = where[Op.and].find((condition) => condition[Op.not])
  expect(negatedCondition).toBeDefined()
  expect(negatedCondition[Op.not][Op.or]).toBeDefined()

  const topicCondition = where[Op.and].find((condition) => condition.topics)
  expect(topicCondition.topics[Op.contains]).toEqual(['swiftui'])

  expect(sequelize.where).toHaveBeenCalledWith(
    { cast: { json: 'info.stargazers_count' }, type: 'int' },
    { [Op.gt]: 500 }
  )
  expect(sequelize.where).toHaveBeenCalledWith(
    { cast: { json: 'info.pushed_at' }, type: 'timestamptz' },
    { [Op.gte]: afterDate }
  )
})
