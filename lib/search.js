const { parse } = require('@muhgholy/search-query-parser')

const CUSTOM_OPERATORS = [
  {
    name: 'error',
    aliases: ['errors'],
    type: 'string',
    allowNegation: true
  },
  {
    name: 'processing',
    aliases: ['indexed', 'indexing'],
    type: 'string',
    allowNegation: true
  },
  {
    name: 'stars',
    aliases: ['star', 'stargazers'],
    type: 'size',
    allowNegation: true
  }
]

function normalizeSearchTerm (term) {
  if (Array.isArray(term)) {
    return term.join(' ')
  }
  if (typeof term === 'string') {
    return term
  }
  return ''
}

function toArray (value) {
  if (!value) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

function buildTextCondition (Op, value) {
  const wildcard = '%' + value + '%'
  return {
    [Op.or]: [
      {
        info: {
          full_name: { [Op.iLike]: wildcard }
        }
      },
      {
        'info.description': { [Op.iLike]: wildcard }
      },
      {
        'description.name': { [Op.iLike]: wildcard }
      }
    ]
  }
}

function wrapNegated (Op, condition, negated) {
  if (!negated) {
    return condition
  }
  return { [Op.not]: condition }
}

function buildTextConditions (Op, values, negated) {
  const usableValues = toArray(values).filter(Boolean)
  if (usableValues.length === 0) {
    return null
  }
  const conditions = usableValues.map(function (value) {
    return buildTextCondition(Op, value)
  })
  const combined = conditions.length === 1 ? conditions[0] : { [Op.or]: conditions }
  return wrapNegated(Op, combined, negated)
}

function buildTopicConditions (Op, values, negated) {
  const usableValues = toArray(values).filter(Boolean)
  if (usableValues.length === 0) {
    return null
  }
  const conditions = usableValues.map(function (value) {
    return { topics: { [Op.contains]: [value] } }
  })
  const combined = conditions.length === 1 ? conditions[0] : { [Op.or]: conditions }
  return wrapNegated(Op, combined, negated)
}

function buildErrorCondition (Op, term) {
  if (!term) {
    return null
  }

  const rawValue = term.value == null ? '' : String(term.value)
  const value = rawValue.trim().toLowerCase()
  let condition = null

  if (value === '' || value === 'none' || value === 'false' || value === 'no' || value === '0' || value === 'null' || value === 'empty') {
    condition = { error: null }
  } else if (value === 'any' || value === 'true' || value === 'yes' || value === '1' || value === 'present' || value === 'exists') {
    condition = { error: { [Op.ne]: null } }
  } else {
    condition = { error: { [Op.iLike]: '%' + rawValue + '%' } }
  }

  return wrapNegated(Op, condition, term.negated)
}

function buildProcessingCondition (Op, term) {
  if (!term) {
    return null
  }

  const rawValue = term.value == null ? '' : String(term.value)
  const value = rawValue.trim().toLowerCase()
  let condition = null

  if (value === '' || value === 'false' || value === 'no' || value === '0' || value === 'none') {
    condition = { processing: false }
  } else if (value === 'true' || value === 'yes' || value === '1') {
    condition = { processing: true }
  } else if (value === 'any') {
    return null
  } else {
    condition = { processing: { [Op.ne]: null } }
  }

  return wrapNegated(Op, condition, term.negated)
}

function buildDateCondition (sequelize, Op, term) {
  if (!term) {
    return null
  }

  const pushedAt = sequelize.cast(sequelize.json('info.pushed_at'), 'timestamptz')
  let comparison = null

  if (term.dateRange && term.dateRange.start && term.dateRange.end) {
    comparison = { [Op.between]: [term.dateRange.start, term.dateRange.end] }
  } else if (term.date) {
    if (term.type === 'before') {
      comparison = { [Op.lte]: term.date }
    } else if (term.type === 'after') {
      comparison = { [Op.gte]: term.date }
    } else {
      comparison = { [Op.eq]: term.date }
    }
  }

  if (!comparison) {
    return null
  }

  return wrapNegated(Op, sequelize.where(pushedAt, comparison), term.negated)
}

function buildStarsCondition (sequelize, Op, term) {
  if (!term || !term.size || typeof term.size.bytes !== 'number') {
    return null
  }

  const opMap = { gt: Op.gt, lt: Op.lt, eq: Op.eq }
  const comparison = { [opMap[term.size.op]]: term.size.bytes }
  const stars = sequelize.cast(sequelize.json('info.stargazers_count'), 'int')

  return wrapNegated(Op, sequelize.where(stars, comparison), term.negated)
}

function buildTermsConditions (sequelize, Op, terms) {
  const andConditions = []
  if (!Array.isArray(terms)) {
    return andConditions
  }
  terms.forEach(function (term) {
    const condition = buildTermCondition(sequelize, Op, term)
    if (condition) {
      andConditions.push(condition)
    }
  })
  return andConditions
}

function buildTermCondition (sequelize, Op, term) {
  if (!term) {
    return null
  }

  if (term.type === 'or') {
    const orConditions = buildTermsConditions(sequelize, Op, term.terms)
    if (orConditions.length === 0) {
      return null
    }
    return wrapNegated(Op, { [Op.or]: orConditions }, term.negated)
  }

  if (term.type === 'group') {
    const groupConditions = buildTermsConditions(sequelize, Op, term.terms)
    if (groupConditions.length === 0) {
      return null
    }
    const combined = groupConditions.length === 1 ? groupConditions[0] : { [Op.and]: groupConditions }
    return wrapNegated(Op, combined, term.negated)
  }

  if (term.type === 'text' || term.type === 'phrase') {
    return buildTextConditions(Op, term.value, term.negated)
  }

  if (term.type === 'label' || term.type === 'tag') {
    return buildTopicConditions(Op, term.value, term.negated)
  }

  if (term.type === 'after' || term.type === 'before' || term.type === 'date') {
    return buildDateCondition(sequelize, Op, term)
  }

  if (term.type === 'stars') {
    return buildStarsCondition(sequelize, Op, term)
  }

  if (term.type === 'error') {
    return buildErrorCondition(Op, term)
  }

  if (term.type === 'processing') {
    return buildProcessingCondition(Op, term)
  }

  if (term.value) {
    return buildTextConditions(Op, term.value, term.negated)
  }

  return null
}

function buildTopicFilters (Op, topicQuery) {
  if (Array.isArray(topicQuery)) {
    return topicQuery.filter(Boolean).map(function (topic) {
      return { topics: { [Op.contains]: [topic] } }
    })
  }
  if (typeof topicQuery === 'string' && topicQuery !== '') {
    return { topics: { [Op.contains]: [topicQuery] } }
  }
  return null
}

function hasTermType (terms, targetType) {
  if (!Array.isArray(terms)) {
    return false
  }
  return terms.some(function (term) {
    if (!term) {
      return false
    }
    if (term.type === targetType) {
      return true
    }
    if ((term.type === 'or' || term.type === 'group') && Array.isArray(term.terms)) {
      return hasTermType(term.terms, targetType)
    }
    return false
  })
}

module.exports = function (router) {
  router.get('/search', async function (req, res) {
    const Op = router.db.Sequelize.Op
    const sequelize = router.db.sequelize
    const term = normalizeSearchTerm(req.query.term)
    const normalizedTerm = term.replace(/\btopic:/gi, 'label:')
    let terms = []

    if (normalizedTerm.trim() !== '') {
      try {
        terms = parse(normalizedTerm, { operators: CUSTOM_OPERATORS })
      } catch (error) {
        console.error('Failed to parse search query', error)
        terms = [{ type: 'text', value: normalizedTerm, negated: false }]
      }
    }

    const andStatement = []
    const termConditions = buildTermsConditions(sequelize, Op, terms)
    if (termConditions.length > 0) {
      andStatement.push.apply(andStatement, termConditions)
    }

    const topicFilters = buildTopicFilters(Op, req.query.topic)
    if (Array.isArray(topicFilters)) {
      andStatement.push.apply(andStatement, topicFilters)
    } else if (topicFilters) {
      andStatement.push(topicFilters)
    }

    const where = {}
    if (!hasTermType(terms, 'processing')) {
      where.processing = false
    }

    if (andStatement.length > 0) {
      where[Op.and] = andStatement
    }

    router.db.Package.findAll({
      where: where,
      order: [[router.db.sequelize.cast(router.db.sequelize.json('info.stargazers_count'), 'int'), 'DESC'], [router.db.sequelize.json('info.name'), 'DESC']]
    }).then(function (packages) {
      const title = term ? term + ' Search' : 'Search'
      res.render('search', { packages: packages, term: term, title: title })
    })
  })
}
