const request = require('request')
const querystring = require('querystring')
const { promisify } = require('util')

const post = promisify(request.post)

module.exports = function (router) {
  router.get('/', async function (req, res) {
    router.db.Package.findAll({
      where: {
        processing: false,
        error: null
      },
      limit: 50,
      order: [[router.db.sequelize.cast(router.db.sequelize.json('info.stargazers_count'), 'int'), 'DESC']]
    }).then(function (popular_packages) {
      router.db.Package.findAll({
        where: {
          processing: false,
          error: null
        },
        limit: 25,
        order: [[router.db.sequelize.col('createdAt'), 'DESC']]
      }).then(function (recent_packages) {
        res.render('index', { popular_packages: popular_packages, recently_created_packages: recent_packages })
      })
    })
  })
}
