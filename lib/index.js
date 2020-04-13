module.exports = function (router) {
  router.get('/', async function (req, res) {
    router.db.Package.findAll({
      where: {
        processing: false,
        error: null,
        'info.stargazers_count': {
          [router.db.Sequelize.Op.not]: null
        }
      },
      limit: 50,
      order: [[router.db.sequelize.cast(router.db.sequelize.json('info.stargazers_count'), 'int'), 'DESC']]
    }).then(function (popularPackages) {
      router.db.Package.findAll({
        where: {
          processing: false,
          error: null,
          info: {
            [router.db.Sequelize.Op.not]: null
          }
        },
        limit: 25,
        order: [[router.db.sequelize.col('createdAt'), 'DESC']]
      }).then(function (recentPackages) {
        router.db.Package.findAll({
          where: {
            processing: false,
            error: null,
            latest_release: {
              [router.db.Sequelize.Op.not]: null
            }
          },
          limit: 25,
          order: [[router.db.sequelize.fn('date', router.db.sequelize.json('latest_release.published_at')), 'DESC']]
        }).then(function (updatedPackages) {
          res.render('index', { popular_packages: popularPackages, recently_created_packages: recentPackages, updatedPackages: updatedPackages })
        })
      })
    })
  })
}
