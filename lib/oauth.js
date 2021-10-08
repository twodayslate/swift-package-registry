// https://jasonet.co/posts/probot-with-ui/
const request = require('request')
const querystring = require('querystring')
const { promisify } = require('util')
const { Octokit } = require('@octokit/rest')

const post = promisify(request.post)

const uuid = require('uuid')

module.exports = function (router) {
  router.use(async (req, res, next) => {
    if (req.session.token) {
      req.oauth = new Octokit({
        auth: req.session.token,
        throttle: {
          onAbuseLimit: function (retryAfter, options) { console.log('onAbuseLimit reached') },
          onRateLimit: function (retryAfter, options) { console.log('onRateLimit reached') }
        }
      })

      await req.oauth.auth()

      const { data } = await req.oauth.users.getAuthenticated()

      if (!req.session.login) {
        req.session.login = data.login
      }

      if (!req.session.github_id) {
        req.session.github_id = data.id
      }

      router.db.User.findOrCreate({
        where: {
          github_id: req.session.github_id
        },
        defaults: {
          github_id: req.session.github_id,
          uuid: uuid.v5(req.session.github_id.toString(), process.env.UUID_NAMESPACE),
          accessToken: req.session.token,
          github_login: req.session.login,
          github_json: data
        }
      }).then(function (users, created) {
        req.user = users[0]
        req.user.github_json = data
        req.user.accessToken = req.session.token
        req.user.save()
        res.locals.user = req.user
        next()
      })
    } else {
      next()
    }
  })

  router.get('/auth/github/login', (req, res) => {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol
    const host = req.headers['x-forwarded-host'] || req.get('host')

    const params = querystring.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      redirect_uri: `${protocol}://${host}/auth/github/callback`
    })
    console.log('client herereerere' + params)
    const url = `https://github.com/login/oauth/authorize?${params}`
    res.redirect(url)
  })

  router.get('/auth/github/callback', async (req, res) => {
    // complete OAuth dance

    const tokenRes = await post({
      url: 'https://github.com/login/oauth/access_token',
      form: {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: req.query.code,
        state: req.query.state
      },
      json: true
    })

    if (tokenRes.statusCode === 200) {
      req.session.token = tokenRes.body.access_token
      if (tokenRes.body.error_description) {
        req.flash('error', tokenRes.body.error_description)
      }
      res.redirect(req.session.redirect || '/')
    } else {
      res.status(500)
      req.flash('Invalid GtiHub code')
      res.redirect(req.session.redirect || '/')
    }
  })

  router.get('/login', function (req, res) {
    if (req.user) {
      res.redirect('/')
      return
    }
    res.render('login')
  })

  router.get('/logout', function (req, res) {
    // https://stackoverflow.com/a/60382823/193772
    req.session.destroy(() => {
      res.redirect('/') // will always fire after session is destroyed
    })
  })
}
