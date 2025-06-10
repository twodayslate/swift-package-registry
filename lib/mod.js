module.exports = function (router) {
  router.get('/mod', async function (req, res) {
    if (!req.user || !req.user.isMod) {
      res.redirect('/')
      return
    }

    // Get filter parameters
    const filter = req.query.filter || 'all'

    // Build where clause for all packages based on filters
    const allPackagesWhere = {
      processing: false // Always exclude processing packages from the main list
    }

    if (filter === 'errors') {
      allPackagesWhere.error = {
        [router.db.Sequelize.Op.and]: [
          { [router.db.Sequelize.Op.not]: null },
          { [router.db.Sequelize.Op.ne]: '' }
        ]
      }
    } else if (filter === 'no-errors') {
      allPackagesWhere[router.db.Sequelize.Op.or] = [
        { error: null },
        { error: '' }
      ]
    }

    router.db.Package.findAll({
      where: {
        processing: true
      },
      order: [[router.db.sequelize.col('createdAt'), 'DESC']]
    }).then(function (processingPackages) {
      router.db.Package.findAll({
        where: allPackagesWhere,
        order: [[router.db.sequelize.col('createdAt'), 'DESC']]
      }).then(function (allPackages) {
        res.render('mod', {
          processing_packages: processingPackages,
          all_packages: allPackages,
          current_filter: filter
        })
      })
    })
  })
}
