module.exports = function (router) {
  router.get('/', async function (req, res) {
    router.db.Package.findAll({
      where: {
        processing: false,
        error: null
      },
      limit: 50,
      order: [[router.db.sequelize.cast(router.db.sequelize.json('info.stargazers_count'), 'int'), 'DESC']]
    }).then(function (popularPackages) {
      router.db.Package.findAll({
        where: {
          processing: false,
          error: null
        },
        limit: 25,
        order: [[router.db.sequelize.col('createdAt'), 'DESC']]
      }).then(function (recentPackages) {
        res.render('index', { popular_packages: popularPackages, recently_created_packages: recentPackages })
      })
    })
  })
}
