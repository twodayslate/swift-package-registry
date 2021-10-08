module.exports = function (router) {
  router.get('/:owner/:repo.json', async function (req, res) {
    const packages = await router.db.Package.findOne({
      where: {
        'info.name': req.params.repo,
        'info.owner.login': req.params.owner
      }
    })
    res.json(packages)
  })
}
