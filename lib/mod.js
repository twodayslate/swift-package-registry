const request = require('request')
const querystring = require('querystring')
const { promisify } = require('util')

const post = promisify(request.post)

module.exports = function (router) {
  router.get('/mod', async function (req, res) {
    if (!req.user || !req.user.isMod) {
      res.redirect('/')
      return
    }

    router.db.Package.findAll({
      where: {
            processing: true,
      },
      order: [[router.db.sequelize.col('createdAt'), 'DESC']]
    }).then(function (processing_packages) {
      router.db.Package.findAll({
        order: [[router.db.sequelize.col('createdAt'), 'DESC']]
      }).then(function (all_packages) {
        res.render('mod', { processing_packages: processing_packages, all_packages: all_packages })
      })
    })
  })
}
