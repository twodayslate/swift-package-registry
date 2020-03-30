const express = require('express')
const session = require('express-session')
const querystring = require('querystring')
const partials = require('express-partials')
const { Op } = require('sequelize')
const oauth = require('./lib/oauth')
const models = require('./models')
const uuid = require('uuid')
var bodyParser = require('body-parser')
const { Octokit } = require('@octokit/rest')
const { parsePackageRobot } = require('./lib/process')
/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Application} app
 */
module.exports = app => {
  // Your code here
  app.log('Yay, the app was loaded!')

  const db = require('./models')
  db.sequelize.authenticate().then(function () {
    db.sequelize.sync({ alter: true }).then(function () {
      if (process.env.REPROCESS_ALL == 'True') {
        app.log('Reporecessing all packages')
        db.Package.update({
          processing: true
        }, {
          where: {}
        }).then(function (rows) {
          console.log('modified', rows)
          //  db.Package.findAll().then(function(packages) {
          //    packages.forEach(function(package) {
          //      parsePackageRobot(app, package)
          //    })
          //  }).catch(function(err) {
          //    console.log('caught an error 2', err)
          // })
        }).catch(function (err) {
          console.log('caught an error', err)
        })
      }
    })
  })

  const express_app = express()
  express_app.use(express.static('public'))
  express_app.db = db
  express_app.set('views', __dirname + '/views')
  express_app.set('view engine', 'ejs')
  express_app.use(session({ secret: 'keyboard cat', resave: false, saveUninitialized: true }))
  express_app.use(partials())
  express_app.use(require('connect-flash')())
  express_app.use(bodyParser.urlencoded({ extended: true }))
  express_app.use(bodyParser.json())

  express_app.use(async (req, res, next) => {
    console.log('setting robot', req.url)
    req.robot = app

    const personal_access = new Octokit({
      auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN
    })
    req.personal_access = personal_access

    const octokit = await app.auth()
    req.octokit = octokit
    const { data } = await octokit.apps.getAuthenticated()

    req.whoami = data
    res.locals.whoami = data
    res.locals.req = req
    res.locals.flash = req.flash()

    next()
  })

  oauth(express_app)
  require('./lib/index')(express_app)
  require('./lib/account')(express_app)
  require('./lib/about')(express_app)
  require('./lib/add')(express_app)
  require('./lib/package')(express_app)
  require('./lib/search')(express_app)
  require('./lib/mod')(express_app)
  require('./lib/delete')(express_app)

  express_app.get('/all', async function (req, res) {
    db.Package.findAll().then(function (packages) {
      req.robot.log('user', req.user)
      res.render('packages', { title: 'All', heading: 'All Swift Packages', packages: packages })
    })
  })

  express_app.get('/whoami', async function (req, res) {
    const octokit = await app.auth()
    const { data } = await octokit.apps.getAuthenticated()
    res.json(data)
  })

  app.router.use(express_app)

  app.on('release.published', async context => {
    app.log('A release was published', context)
  })

  var remove_is_install = function (repo) {
    db.Package.findOne({
      where: {
        github_id: repo.id
      }
    }).then(function (_package) {
      _package.is_installed = false
      _package.save()
    }).catch(function (err) {})
  }

  var add_repo = async function (context, repo) {
    if (repo.private) {
      return
    }
    const owner = repo.full_name.split('/')[0]
    const name = repo.full_name.split('/')[1]

    var latest_release
    try {
      latest_release = await context.github.repos.getLatestRelease({ owner, repo: name })
    } catch (err) {}

    var ref = 'master'
    if (latest_release) {
      ref = latest_release.tag_name
    }

    var pkg
    try {
      pkg = await context.github.repos.getContents({ owner, repo: name, path: 'Package.swift', ref })
    } catch (err) { return }

    if (pkg) {
      const info = await context.github.repos.get({ owner, repo: name })

      db.Package.findOrCreate({
        where: { github_id: repo.id },
        defaults: {
          github_id: repo.id,
          info: info
        }
      }).then(function (packages, created) {
        const _package = packages[0]

        _package.info = repository.data
        is_installed = true
        _package.save()

        parsePackageContext(context, _package)
      })
    }
  }

  app.on('installation', async context => {
    const payload = context.payload
    app.log('An installation was ', payload.action)

    // console.log(context)

    const jwt = app.app.getSignedJsonWebToken()
    context.log('jwt', jwt)

    if (payload.action == 'created') {
      payload.repositories.forEach(async function (repo) {
        add_repo(context, repo)
      })
    } else if (payload.action == 'deleted') {
      payload.repositories.forEach(async function (repo) {
        remove_is_install(repo)
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
        add_repo(context, repo)
      })
    }
    if (payload.repositories_removed) {
      payload.repositories_removed.forEach(function (repo) {
        remove_is_install(repo)
      })
    }
  })

  app.on('release', async context => {
    const payload = context.payload
    console.log(context.payload)
    if (!payload) {
      return
    }

    if (!payload.repository) {
      return
    }

    db.Package.findOne({
      where: {
        github_id: payload.repository.id
      }
    }).then(function (_package) {
      _package.is_installed = true
      _package.save()
      add_repo(context, repo)
    }).catch(function (err) { })
  })

  // app.on('star', async context => {
  //   // github permissions is down so can't test
  // })
}
