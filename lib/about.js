const request = require('request')
const { promisify } = require('util')
var fs = require('fs')
const post = promisify(request.post)
const { Octokit } = require("@octokit/rest");

module.exports = function (router) {
  router.get('/about', async function (req, res) {
    fs.readFile('README.md', 'utf-8', async function(err, contents) {
      if (err) {
        res.render('about', { user: req.user, title: 'About', readme: err })
        return
      }

      const personal_access = new Octokit({
        auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN
      });

      const readme_md = await personal_access.markdown.render({text: contents, mode: "gfm", context: "twodayslate/swift-package-registry"})

      res.render('about', { user: req.user, title: 'About', readme: readme_md.data })
    })
  })
}
