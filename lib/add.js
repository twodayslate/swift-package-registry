const { parsePackageQueue } = require('./process')

var processingQueue = []

module.exports = function (router) {
  router.get('/add', async function (req, res) {
    res.render('add', { title: 'Add a Swift Package' })
  })

  router.post('/add', async function (req, res) {
    var parsedUrl

    var onInvalidURL = function () {
      req.flash('error', 'Invalid GitHub URL')
      res.status(400)
      res.redirect('/add')
    }

    try {
      parsedUrl = new URL(req.body.url)
    } catch (err) {
      onInvalidURL()
      return
    }

    if (parsedUrl.hostname === 'github.com' || parsedUrl.hostname === 'swiftpackageregistry.com' || parsedUrl.hostname === 'swiftpkg.dev') {
      const fullName = parsedUrl.pathname.trim().replace('.git', '').replace(/^\/|\/$/g, '') // https://stackoverflow.com/a/3840645/193772
      if (fullName.split('/').length !== 2) {
        onInvalidURL()
        return
      }

      const owner = fullName.split('/')[0]
      const repo = fullName.split('/')[1]

      const repository = await req.octokitWithPersonalAccessToken.repos.get({ owner, repo })

      if (repository.private) {
        onInvalidURL()
        return
      }

      const [_package, created] = await router.db.Package.findOrCreate({
        where: { github_id: repository.data.id },
        defaults: {
          github_id: repository.data.id,
          info: repository.data
        }
      })

      if (created) {
        req.log('Newly created package', _package.info.full_name)
        // only parse newly created packages
        processingQueue.push(_package)
      } else {
        _package.info = repository.data
        _package.save()

        // todo: only process if there is an update
        processingQueue.push(_package)
      }

      parsePackageQueue(processingQueue)

      res.redirect(_package.info.full_name)
    } else {
      onInvalidURL()
    }
  })
}
