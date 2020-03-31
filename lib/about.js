var fs = require('fs')

module.exports = function (router) {
  router.get('/about', async function (req, res) {
    fs.readFile('README.md', 'utf-8', async function (err, contents) {
      if (err) {
        res.render('about', { user: req.user, title: 'About', readme: err })
        return
      }

      const readmemd = await req.octokitWithPersonalAccessToken.markdown.render({ text: contents, mode: 'gfm', context: 'twodayslate/swift-package-registry' })

      res.render('about', { user: req.user, title: 'About', readme: readmemd.data })
    })
  })
}
