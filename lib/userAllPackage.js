module.exports = function (router) {
  router.get('/:owner', async function(req, res) {
    var packages = await router.db.Package.findAll({
      where: {
        'info.owner.login': req.params.owner
      }})
    res.render('userAllPackage', { packages: packages,title: req.params.owner + "All Packages" })
  })
}
