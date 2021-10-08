module.exports = function (router) {
  router.get('/:owner.json', async function (req, res) {
    const packages = await router.db.Package.findAll({
      where: {
        'info.owner.login': req.params.owner
      }
    })
    res.json(packages)
  })
}
