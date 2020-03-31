module.exports = function (router) {
  router.post('/delete/:id', function (req, res) {
    if (!req.user || !req.user.isAdmin) {
      res.status(403)
      res.redirect('/')
      return
    }

    router.db.Package.findOne({
      where: {
        id: req.params.id
      }
    }).then(function (_package) {
      if (_package) {
        _package.destroy()
      }
      res.redirect('/')
    })
  })
}
