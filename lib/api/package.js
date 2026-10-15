const isRepositoryDenied = require('../repository-denylist')
module.exports = function (router) {
  router.get('/:owner/:repo.json', async function (req, res) {
    if (isRepositoryDenied(req.params.owner + '/' + req.params.repo)) {
      res.status(404).json(null)
      return
    }

    var myPackage = await router.db.Package.findOne({
      where: {
        'info.name': req.params.repo,
        'info.owner.login': req.params.owner
      }
    })
    res.json(myPackage)
  })
}
