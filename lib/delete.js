const request = require('request')
const querystring = require('querystring')
const {promisify} = require('util')

const post = promisify(request.post)


module.exports = function(router) {
  router.post('/delete/:id', function(req, res) {
    if (!req.user || !req.user.isAdmin) {
      res.redirect("/")
      return
    }
    
    router.db.Package.findOne({
        where: {
            id: req.params.id
        }
    }). then(function(package) {
        if(package) {
            package.destroy()
        }
        res.redirect("/")
    })
  });
}
