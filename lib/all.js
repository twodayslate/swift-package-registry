module.exports = function (router) {
  router.get('/all', async function (req, res) {
    router.db.Package.findAll({
      where: {
        processing: false
      }
    }).then(function (packages) {
      req.robot.log('user', req.user)
      res.render('packages', { title: 'All', heading: 'All Swift Packages', packages: packages })
    })
  })
}