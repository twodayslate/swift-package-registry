const { parsePackageRequest } = require('./process')

var async = require('async')

const rawQueueSize = process.env.PROCESS_QUEUE_SIZE
const parsedQueueSize = parseInt(rawQueueSize || '', 10)
const queueConcurrency = Number.isFinite(parsedQueueSize) && parsedQueueSize > 0 ? parsedQueueSize : 1
console.log('addQueue: configured concurrency', queueConcurrency, 'raw:', rawQueueSize)

var addQueue = async.queue(async function (task, callback) {
  const fullName = task.package && task.package.info ? task.package.info.full_name : 'unknown'
  console.log('addQueue: processing package in queue', fullName)
  try {
    await parsePackageRequest(task.req, task.package)
    console.log('addQueue: finished processing', fullName)
    callback()
  } catch (err) {
    console.error('addQueue: error processing', fullName, err)
    callback(err)
  }
}, queueConcurrency)

addQueue.error(function (err, task) {
  const fullName = task && task.package && task.package.info ? task.package.info.full_name : 'unknown'
  console.error('addQueue: task error', fullName, err)
})

addQueue.drain(function () {
  console.log('addQueue: queue drained')
})

module.exports = function (router) {
  router.get('/add', async function (req, res) {
    res.render('add', { title: 'Add a Swift Package' })
  })

  router.post('/add', async function (req, res) {
    var parsedUrl
    console.log('add: received add request', req.body && req.body.url)

    var onInvalidURL = function () {
      console.log('add: invalid URL', req.body && req.body.url)
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
      console.log('add: parsed full name', fullName)
      if (fullName.split('/').length !== 2) {
        onInvalidURL()
        return
      }

      const owner = fullName.split('/')[0]
      const repo = fullName.split('/')[1]

      let repository
      try {
        console.log('add: fetching repository', owner + '/' + repo)
        repository = await req.octokitWithPersonalAccessToken.repos.get({ owner, repo })
      } catch (err) {
        console.error('add: failed to fetch repository', owner + '/' + repo, err)
        req.flash('error', 'Unable to fetch repository')
        res.status(400)
        res.redirect('/add')
        return
      }

      if (repository.private) {
        console.log('add: repository is private', owner + '/' + repo)
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
        console.log('add: newly created package', _package.info.full_name)
        // only parse newly created packages
        console.log('add: queue size before push', addQueue.length())
        addQueue.push({ req: req, package: _package })
      } else {
        _package.info = repository.data
        _package.save()

        console.log('add: updating existing package', _package.info.full_name)

        // todo: only process if there is an update
        console.log('add: queue size before push', addQueue.length())
        addQueue.push({ req: req, package: _package })
      }

      console.log('add: redirecting to package page', _package.info.full_name)
      res.redirect(_package.info.full_name)
    } else {
      onInvalidURL()
    }
  })
}
