const request = require('request')
const querystring = require('querystring')
const {promisify} = require('util')
var fs = require('fs');
const post = promisify(request.post)
const { parsePackageRequest } = require('./process')


module.exports = function(router) {
    router.get('/add', async function(req, res) {
        res.render('add', {title: "Add a Swift Package"})
    });

    router.post('/add', async function(req, res) {
        var parsedUrl;
        try {
            parsedUrl = new URL(req.body.url);
        } catch(err) {
            req.flash('error', 'Invalid GitHub URL')
            res.redirect('/add')
            return
        }

        if(parsedUrl.hostname == "github.com" || parsedUrl.hostname == "swiftpackageregistry.com" || parsedUrl.hostname == "swiftpkg.dev") {
            const full_name = parsedUrl.pathname.trim().replace(".git","").replace(/^\/|\/$/g, ''); // https://stackoverflow.com/a/3840645/193772
            if (full_name.split("/").length != 2) {
              req.flash('error', 'Invalid GitHub URL')
              res.redirect('add')
              return
            }

            const owner = full_name.split('/')[0]
            const repo = full_name.split('/')[1]

            const repository = await req.personal_access.repos.get({owner, repo});

            if(repository.private) {
                req.flash('error', "Only public repositories can be added!")
                res.redirect('/add')
                return
            }

            router.db.Package.findOrCreate({
              where: { github_id: repository.data.id },
              defaults: {
                github_id: repository.data.id,
                info: repository.data
              }
            }).then(function(packages, created) {
                let package = packages[0]

                if(created) {
                    // only parse newly created packages
                    parsePackageRequest(req, package)
                } else {
                    package.info = repository.data
                    package.save()

                    if(req.user && req.user.isMod && req.body.reprocess=="True") {
                        req.log("reprocessing", package.info.full_name)
                        parsePackageRequest(req, package)
                    }
                }
                
                res.redirect(repository.data.full_name)
            });
        } else {
            req.flash('error', 'Invalid GitHub URL')
            res.redirect('/add')
        }
    });
}
