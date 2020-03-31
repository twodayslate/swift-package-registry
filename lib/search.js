module.exports = function (router) {
  router.get('/search', async function (req, res) {
    var wildcard = '%%'
    var term = ''
    var orStatement = []
    var andStatement = []

    if (Array.isArray(req.query.term)) {
      wildcard = ''
      req.query.term.forEach(function (term) {
        wildcard = wildcard + '%' + term
      })
      wildcard = wildcard + '%'
      term = req.query.term[0]
    } else {
      term = req.query.term || ''
      wildcard = '%' + term + '%'
    }

    if (wildcard !== '' && wildcard !== '%%') {
      orStatement.push({
        info: {
          full_name: { [router.db.Sequelize.Op.iLike]: wildcard }
        }
      })

      orStatement.push({
        'info.description': { [router.db.Sequelize.Op.iLike]: wildcard }
      })
    }

    if (Array.isArray(req.query.topic)) {
      andStatement.push({
        topics: { [router.db.Sequelize.Op.contains]: req.query.topic }
      })
    } else {
      const topic = req.query.topic || ''
      if (topic !== '') {
        orStatement.push({
          topics: { [router.db.Sequelize.Op.contains]: [topic] }
        })
      }
    }

    var where = {
      processing: false
    }

    if (orStatement && orStatement.length > 0) {
      where[router.db.Sequelize.Op.or] = orStatement
    }

    if (andStatement && andStatement.length > 0) {
      where[router.db.Sequelize.Op.and] = andStatement
    }

    console.log(where)

    router.db.Package.findAll({
      where: where,
      order: [[router.db.sequelize.cast(router.db.sequelize.json('info.stargazers_count'), 'int'), 'DESC'], [router.db.sequelize.json('info.name'), 'DESC']]
    }).then(function (packages) {
      res.render('search', { packages: packages, term: term, title: term + ' Search' })
    })
  })
}
