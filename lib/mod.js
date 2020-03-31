module.exports = function (router) {
  router.get('/mod', async function (req, res) {
    if (!req.user || !req.user.isMod) {
      res.redirect('/')
      return
    }

    router.db.Package.findAll({
      where: {
        processing: true
      },
      order: [[router.db.sequelize.col('createdAt'), 'DESC']]
    }).then(function (processingPackages) {
      router.db.Package.findAll({
        order: [[router.db.sequelize.col('createdAt'), 'DESC']]
      }).then(function (allPackages) {
        res.render('mod', { processing_packages: processingPackages, all_packages: allPackages })
      })
    })
  })
}
