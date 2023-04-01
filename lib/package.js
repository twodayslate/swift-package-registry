const { parsePackageRequest } = require('./process')

module.exports = function (router) {
  router.get('/:owner/:repo.json', async function (req, res) {
    var myPackage = await router.db.Package.findOne({
      where: {
        'info.name': req.params.repo,
        'info.owner.login': req.params.owner
      }
    })
    res.json(myPackage)
  })

  router.get('/:owner/:repo', async function (req, res) {
    const fullName = req.params.owner + '/' + req.params.repo
    req.octokitWithPersonalAccessToken.repos.get({ owner: req.params.owner, repo: req.params.repo }).then(async function (repository) {
      if (!repository || !repository.data) {
        res.status(404)
        req.flash('warning', 'This is not a GitHub repository!')
        res.render('404')
        return
      }

      if (repository.data.full_name !== fullName) {
        // this repository was renamed so go to the real one
        res.redirect('/' + repository.data.full_name)
        return
      }

      try {
        const [_package, created] = await router.db.Package.findOrCreate({
          where: {
            github_id: repository.data.id
          },
          defaults: {
            github_id: repository.data.id,
            info: repository.data
          }
        })
        if (created) {
          parsePackageRequest(req, _package)
        } else {
          _package.info = repository.data
          _package.save()
        }

        var title = repository.data.name
        if (_package.description) {
          title = _package.description.name
        }

        res.render('package', { repository: repository.data, package: _package, title: title })
      } catch (err) {
        res.flash(500)
        req.flash('err_message', err.message)
        req.flash('err', err)
        res.render('500')
      }
    }).catch(function (err) {
      if (err.status === 404) {
        res.status(404)
        req.flash('warning', 'This is not a GitHub repository!')
        res.render('404')
        return
      }
      res.status(500)
      req.flash('err_message', err.message)
      req.flash('err', err)
      res.render('500')
    })
  })
}
