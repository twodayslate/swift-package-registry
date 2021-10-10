module.exports = function (router) {
  router.get('/all.json', router.apicache('1 day'), async function (req, res) {
    router.db.Package.findAll({
      where: {
        processing: false
      }
    }).then(function (packages) {
      res.json(packages)
    })
  })
}
