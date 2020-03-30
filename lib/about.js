const request = require('request')
const { promisify } = require('util')
var fs = require('fs')
const post = promisify(request.post)

module.exports = function (router) {
  router.get('/about', async function (req, res) {
    fs.readFile('README.md', 'utf-8', function (err, contents) {
      if (err) {
        res.render('about', { user: req.user, title: 'About', readme: err })
        return
      }
      var url = new URL('https://github.com/twodayslate/swift-package-registry/')
      url.hostname = 'raw.githubusercontent.com'
      url.pathname = url.pathname + '/master'
      var marked = require('marked')
      marked.setOptions({
        baseUrl: url.toString(),
        renderer: new marked.Renderer(),
        highlight: function (code, language) {
          const hljs = require('highlight.js')
          const validLanguage = hljs.getLanguage(language) ? language : 'plaintext'
          return hljs.highlight(validLanguage, code).value
        },
        gfm: true,
        breaks: false
      })

      res.render('about', { user: req.user, title: 'About', readme: marked(contents) })
    })
  })
}
