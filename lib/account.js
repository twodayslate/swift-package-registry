const request = require('request')
const { promisify } = require('util')

module.exports = function (router) {
  router.get('/account', async function (req, res) {
    // todo: use middleware here
    if (!req.user) {
      res.redirect('/login')
      return
    }

    const pageSize = 50
    const currentPage = parseInt(req.query.page) || 1

    console.log('app:', req.robot.app)

    req.robot.auth().then(async function (octokit) {
      console.log(octokit)

      const jwt = req.robot.app.getSignedJsonWebToken()

      octokit.apps.listInstallations().then(async function (apps) {
        console.log('apps', apps)
        const needsInstall = (apps.data.length < 1)

        if (needsInstall) {
          octokit.apps.getAuthenticated().then(function (whoami) {
            console.log('whoami', whoami)
            res.render('account', { user: req.user, needsInstall: needsInstall, whoami: whoami.data })
          })

          return
        }

        const app = apps.data[0]

        octokit.request('POST /app/installations/:installation_id/access_tokens', {
          installation_id: '' + app.id,
          headers: {
            authorization: `Bearer ${jwt}`,
            accept: 'application/vnd.github.machine-man-preview+json'
          }
        }).then(function (accessTokens) {
          // const token = accessTokens.data.token

          const installation_id = app.id

          req.oauth.apps.listInstallationReposForAuthenticatedUser({ installation_id, per_page: pageSize, page: currentPage }).then(function (repos) {
            res.render('account', { user: req.user, needsInstall: needsInstall, req: req, repos: repos.data, page: currentPage, per_page: pageSize, app: app })
          })
        }).catch(function (err) {
          res.json(err)
        })
      })
    })
  })
}
