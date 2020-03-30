const request = require('request')
const querystring = require('querystring')
const {promisify} = require('util')
const { Op } = require("sequelize");
const post = promisify(request.post)
const { parsePackageRequest } = require('./process')


module.exports = function(router) {
    router.get('/:owner/:repo', async function(req, res) {
        let full_name = req.params.owner + '/' + req.params.repo
        req.personal_access.repos.get({owner: req.params.owner, repo: req.params.repo}).then(async function(repository) {
            if (!repository || !repository.data) {
                res.status(404)
                req.flash('warning', 'This is not a GitHub repository!')
                res.render('404')
                return
            }

            if(repository.data.full_name != full_name) {
                // this repository was renamed so go to the real one
                res.redirect('/' + repository.data.full_name)
                return
            }

            try {
                const [_package, created] = await router.db.Package.findOrCreate({
                where: {
                    github_id: repository.data.id
                }, 
                defaults: {
                    github_id: repository.data.id,
                    info: repository.data
                }
            })
                if(created) {
                    // todo: process
                    parsePackageRequest(req,_package)
                } else {
                    _package.info = repository.data
                    _package.save()
                }

                res.render('package', {repository: repository.data, package: _package, title: repository.data.name})
            } catch(err) {
                res.flash(500)
                req.flash('err_message', err.message)
                req.flash('err', err)
                res.render('500')
            }
             
        }).catch(function(err) {
            if (err.status == 404) {
                res.status(404)
                req.flash("warning", "This is not a GitHub repository!")
                res.render('404')
                return
            }
            res.status(500)
            req.flash('err_message', err.message)
            req.flash('err', err)
            res.render('500')
            return
        })
    });
}
