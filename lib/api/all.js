module.exports = function (router) {
  router.get('/all.json', async function (req, res) {
    router.db.Package.findAll({
      where: {
        processing: false
      }
    }).then(function (packages) {
      req.robot.log('user', req.user)
      res.json(packages)
      //res.render('packages', { title: 'All', heading: 'All Swift Packages', packages: packages })
    })
  })
}