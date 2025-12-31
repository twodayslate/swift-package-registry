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
    json: jest.fn((value) => value),
    cast: jest.fn((value, type) => ({ value, type }))
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
  parse.mockReturnValue([
    { type: 'text', value: 'networking', negated: false },
    { type: 'text', value: 'cache', negated: false },
    { type: 'label', value: 'swiftui', negated: false },
    { type: 'text', value: 'beta', negated: true }
  ])

  const { handler, Package, Sequelize } = buildRouter()
  const req = { query: { term: 'networking cache topic:swiftui -beta' } }
  const res = { render: jest.fn() }

  await handler(req, res)

  expect(parse).toHaveBeenCalledWith('networking cache label:swiftui -beta')
  expect(Package.findAll).toHaveBeenCalledTimes(1)

  const where = Package.findAll.mock.calls[0][0].where
  const { Op } = Sequelize

  expect(where.processing).toBe(false)
  expect(where[Op.and]).toHaveLength(4)

  const textConditions = where[Op.and].filter((condition) => condition[Op.or])
  expect(textConditions).toHaveLength(2)

  const negatedCondition = where[Op.and].find((condition) => condition[Op.not])
  expect(negatedCondition).toBeDefined()
  expect(negatedCondition[Op.not][Op.or]).toBeDefined()

  const topicCondition = where[Op.and].find((condition) => condition.topics)
  expect(topicCondition.topics[Op.contains]).toEqual(['swiftui'])
})
