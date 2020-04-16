const express = require('express')
const session = require('express-session')
const partials = require('express-partials')
const oauth = require('./lib/oauth')
var bodyParser = require('body-parser')
const { Octokit } = require('@octokit/rest')
const { parsePackageContext } = require('./lib/process')
const path = require('path')

/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Application} app
 */
module.exports = async function (app) {
  // Your code here
  app.log('Yay, the app was loaded!')

  const db = require('./models')
  await db.sequelize.authenticate()
  await db.sequelize.sync({ alter: true })

  if (process.env.REPROCESS_ALL === 'True') {
    app.log('Reporecessing all packages')
    db.Package.update({
      processing: true
    }, {
      where: {}
    }).then(function (rows) {
      console.log('modified', rows)
    }).catch(function (err) {
      console.log('caught an error', err)
    })
  }

  const expressApp = express()
  expressApp.use(express.static('public'))
  expressApp.db = db
  expressApp.set('views', path.join(__dirname, 'views'))
  expressApp.set('view engine', 'ejs')
  expressApp.use(session({ secret: 'keyboard cat', resave: false, saveUninitialized: true }))
  expressApp.use(partials())
  expressApp.use(require('connect-flash')())
  expressApp.use(bodyParser.urlencoded({ extended: true }))
  expressApp.use(bodyParser.json())

  expressApp.use(async (req, res, next) => {
    console.log('setting robot', req.url)
    req.robot = app

    const personalAccess = new Octokit({
      auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN
    })
    req.octokitWithPersonalAccessToken = personalAccess

    const octokit = await app.auth()
    req.octokit = octokit
    const { data } = await octokit.apps.getAuthenticated()

    req.whoami = data
    res.locals.whoami = data
    res.locals.req = req
    res.locals.flash = req.flash()

    res.locals.packageCount = await db.Package.count({ where: { processing: false, error: null } })

    next()
  })

  oauth(expressApp)
  require('./lib/index')(expressApp)
  require('./lib/account')(expressApp)
  require('./lib/about')(expressApp)
  require('./lib/add')(expressApp)
  require('./lib/package')(expressApp)
  require('./lib/search')(expressApp)
  require('./lib/mod')(expressApp)
  require('./lib/delete')(expressApp)

  expressApp.get('/all', async function (req, res) {
    db.Package.findAll({
      where: {
        processing: false
      }
    }).then(function (packages) {
      req.robot.log('user', req.user)
      res.render('packages', { title: 'All', heading: 'All Swift Packages', packages: packages })
    })
  })

  expressApp.get('/whoami', async function (req, res) {
    const octokit = await app.auth()
    const { data } = await octokit.apps.getAuthenticated()
    res.json(data)
  })

  app.router.use(expressApp)

  app.on('release.published', async context => {
    app.log('A release was published', context)
  })

  var removeIsInstall = function (repo) {
    db.Package.findOne({
      where: {
        github_id: repo.id
      }
    }).then(function (_package) {
      _package.is_installed = false
      _package.save()
    }).catch(() => {})
  }

  var addRepo = async function (context, repo) {
    if (repo.private) {
      return
    }
    const owner = repo.full_name.split('/')[0]
    const name = repo.full_name.split('/')[1]

    var latestRelease
    try {
      var { data } = await context.github.repos.getLatestRelease({ owner, repo: name })
      latestRelease = data
    } catch (err) {}

    var ref = 'master'
    if (latestRelease) {
      ref = latestRelease.tag_name
    }

    var pkg
    try {
      var { data }= await context.github.repos.getContents({ owner, repo: name, path: 'Package.swift', ref })
      pkg = data
    } catch (err) { return }

    if (pkg) {
      const { data: info } = await context.github.repos.get({ owner, repo: name })

      if (!info) { return }

      const [_package] = await db.Package.findOrCreate({
        where: { github_id: repo.id },
        defaults: {
          github_id: repo.id,
          info: info
        }
      })

      _package.info = info
      _package.is_installed = true
      _package.save()

      parsePackageContext(context, _package)
    }
  }

  app.on('installation', async context => {
    const payload = context.payload
    app.log('An installation was ', payload.action)

    // console.log(context)

    const jwt = app.app.getSignedJsonWebToken()
    context.log('jwt', jwt)

    if (payload.action === 'created') {
      payload.repositories.forEach(async function (repo) {
        addRepo(context, repo)
      })
    } else if (payload.action === 'deleted') {
      payload.repositories.forEach(async function (repo) {
        removeIsInstall(repo)
      })
    }
  })

  app.on('integration_installation', async context => {
    const payload = context.payload
    app.log('An integration_installation was', payload.action)

    console.log('installation_id', context.payload.installation.id)
    // const { authed} = await context.github.auth({installationId: context.payload.installation.id})
    // console.log('authed', authed)
    try {
      const { user } = await context.github.users.getAuthenticated()
      app.log('user', user)
    } catch (err) {
      app.log({ err })
    }

    try {
      const { data } = await context.github.apps.listInstallations()
      app.log(data)
    } catch (err) {
      app.log({ err })
    }

    try {
      const { repos } = await context.github.repos.list()
      app.log(repos)
    } catch (err) {
      app.log({ err })
    }
  })

  app.on('installation_repositories', async context => {
    const payload = context.payload
    if (!payload) { return }
    if (payload.repositories_added) {
      payload.repositories_added.forEach(function (repo) {
        addRepo(context, repo)
      })
    }
    if (payload.repositories_removed) {
      payload.repositories_removed.forEach(function (repo) {
        removeIsInstall(repo)
      })
    }
  })

  app.on(['release', 'public', 'created'], async context => {
    const payload = context.payload
    console.log(context.payload)
    if (!payload) {
      return
    }

    if (!payload.repository) {
      return
    }

    await addRepo(context, payload.repository)
  })

  var updateRepoInfo = async function (context, repo) {
    const owner = repo.full_name.split('/')[0]
    const name = repo.full_name.split('/')[1]

    const { data: info } = await context.github.repos.get({ owner, repo: name })

    if (!info) { return }

    const _package = await db.Package.findOne({
      where: { github_id: repo.id }
    })
    if (_package) {
      _package.info = info
      _package.save()
    }
  }

  app.on(['star', 'repository'], async context => {
    const payload = context.payload

    if (!payload) { return }

    if (!payload.repository) { return }

    if (payload.repository.private) {
      return
    }
    const repo = payload.repository

    updateRepoInfo(context, repo)
  })
}
