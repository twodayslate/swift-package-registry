module.exports = function (router) {
  router.get('/:owner', async function (req, res) {
    var packages = await router.db.Package.findAll({
      where: {
        'info.owner.login': req.params.owner
      }
    })
    if (packages.length > 0) {
      res.render('userAllPackage', { packages: packages, setTitle: req.params.owner + "'s Packages", title: req.params.owner + "'s Packages" })
    } else {
      res.status(404)
      res.render('404', { noExist: 'This user does not exist!' })
    }
  })
}
