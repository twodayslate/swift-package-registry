var { runCommand } = require('./docker')
var Docker = require('dockerode');
var docker = new Docker();
const { Octokit } = require("@octokit/rest");


const docker_tags = ["swift:latest", "swift:5.2", "swift:5.1", "swift:5.0", "swift:4.2", "swift:4.1", "swift:4.0", "swift:3.1"];


var robotPackage = async function(package, callback) {
    const personal_access = new Octokit({
        auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN
    });
 
    if (!package.info) {
        var owner;
        var repo;
        if (package.full_name) {
            owner = package.full_name.split('/')[0]
            repo = package.full_name.split('/')[1]
        }
        personal_access.repos.get({owner: owner, repo: repo}).then(function(repository) {
            package.info = repository.data
            package.save()
            console.log("going to parse", package.full_name, 'again')
            robotPackage(package, callback)
        })
        return
    }

    personal_access.repos.listReleases({owner: package.info.owner.login, repo: package.info.name }).then(async function(releases) {
        var release;
        var ref = package.info.default_branch
        var tarball = package.info.url + '/tarball'
        releases.data.some(function(ele) {
            console.log(ele);
            if (!ele.draft && !ele.prerelease) {
              release = ele;
              return true
            }
        });
        if(release) {
            ref = release.tag_name
            tarball = release.tarball_url
            
            const readme_md = await personal_access.markdown.render({text: release.body, mode: "gfm", context: package.info.full_name})
            release.body = readme_md.data
            package.latest_release = release
            package.save()
            
        }

        personal_access.request('GET /repos/:owner/:repo/readme', {
            owner: package.info.owner.login,
            repo: package.info.name,
            ref: ref,
            headers: {
                accept: "application/vnd.github.v3.html"
            }
        }).then(function(readme) {
            package.readme = readme.data
            package.readme.save()
        }).catch(function(err) {})

        personal_access.repos.listTopics({owner: package.info.owner.login, repo: package.info.name }).then(function(topics) {
            package.topics = topics.data.names
            package.save()

            var cb = function(err, swift_dump, tools_version, description, dependencies) {
                if(err) {
                    package.processing = false
                    package.error = err.message || err
                    return callback(err)
                }

                if(swift_dump) { package.dump = swift_dump}
                if(tools_version) { package.tools_version = tools_version}
                if(description) { package.description = description }
                if(dependencies) { package.dependencies = dependencies }
                package.processing = false
                package.error = null
                package.save()

                callback(null)
            }

            
            var index = 0;

            var loop_cb = function(err, swift_dump, tools_version, description, dependencies) {
                if(err) {
                  index = index +1;
                  if (index < docker_tags.length) {
                      return processTarball(docker_tags[0], tarball, loop_cb)
                  } else {
                    return cb(err)
                  }
                }

                cb(err, swift_dump, tools_version, description, dependencies)
            }

            processTarball(docker_tags[0], tarball, loop_cb)

        }).catch(function(err) { callback(err)})
    }).catch(function(err) { callback(err)})
}

var processTarball = async function(tag, tarball, callback) {
    var _container;

    var swift_dump;
    var tools_version;
    var description;
    var dependencies;

    const baseDir = "/usr/src/"
    const packageDir = "/usr/src/package"

    function onError(err) {
        var cb = function() {
            callback(err, swift_dump, tools_version, description, dependencies)
        }

        if (_container) {
            _container.stop(function (err, data) {
                _container.remove(function (err, data) {
                    console.log("done :)")
                    return cb()
                });
            });
        } else {
            cb()
        }
    }

    function runCommandAndCheck(cmd, dir, cb) {
        runCommand(_container, cmd, dir, function(err, stdout, stderr, inspect_data) {
            if(err) {
                return onError(err)
            }
            if(inspect_data.ExitCode != 0) { 
                console.log("exit code not zero when running", cmd, stdout, stderr, inspect_data); 
                return onError(stderr || stdout);
            }
            cb(stdout, stderr)
        })
    }

    docker.pull(tag, function(err, stream){
        if(err) {
            return onError(err)
        }

        docker.createContainer({Image: tag, Cmd: ['/bin/bash'], AutoRemove: true, Tty: true,}, function (err, container) {
            if(err) {
                return onError(err)
            }

            _container = container;

                // apt-get update
                // apt-get --no-install-recommends --yes wget
                // wget ${tarball} --quiet --output-document=package.tar.gz
                // mkdir -p package
                // tar -xf package.tar.gz -C package --strip-components=1
                // cd package
                // swift package tools-version
                // swift package describe --type=json
                // swift package show-dependencies --foramt=json
                // swift package dump-package
                // cat README.txt

            try {
                container.start(function (err) {
                    runCommandAndCheck(['apt-get', 'update'], baseDir, function(stdout, stderr) {
                        runCommandAndCheck(['apt-get', 'install', '--no-install-recommends', '--yes', 'wget'], baseDir, function(stdout, stderr) {
                            runCommandAndCheck(['mkdir', '-p', 'package'], baseDir, function(stdout, stderr) {
                                // https://stackoverflow.com/a/8378458/193772
                                runCommandAndCheck(['wget', tarball, '--header', 'Authorization: token ' + process.env.GITHUB_PERSONAL_ACCESS_TOKEN, '--header', 'Accept:application/vnd.github.v3.raw', '--output-document=package.tar.gz'], baseDir, function(stdout, stderr) {
                                    runCommandAndCheck(['tar', 'xf', 'package.tar.gz', '-C', 'package', '--strip-components=1'], baseDir, function(stdout, stderr) {
                                        runCommandAndCheck(['swift', 'package', 'tools-version'], packageDir, function(stdout, stderr) {
                                            tools_version = stdout.trim()
                                            runCommandAndCheck(['swift', 'package', 'describe', '--type=json'], packageDir, function(stdout, stderr) {
                                                description = JSON.parse(stdout)
                                                runCommandAndCheck(['swift', 'package', 'show-dependencies', '--format=json'], packageDir, function(stdout, stderr) {
                                                    dependencies = JSON.parse(stdout.substr(stdout.indexOf('{')))
                                                    runCommandAndCheck(['swift', 'package', 'dump-package'], packageDir, function(stdout, stderr) {
                                                        swift_dump = JSON.parse(stdout)
                                                        onError(null);
                                                    })
                                                })
                                            })
                                        })
                                    })
                                })
                            })
                        })
                    })
                })
            } catch(err) {
                return onError(err)
            }
        })
    })
}

module.exports = {
    processTarball: async function(tag, tarball, callback) {
        return processTarball(tag, tarball, callback)
    },

    parsePackageRequest: async function(req, package) { // this is models.Package
        return robotPackage(package, function(err) {
            if(err) {
                req.log("Got an error processing", package.info.full_name, err)
                package.processing = false
                package.save()
                return
            }
        })
    },

    parsePackageContext: async function(context, package) {
        return robotPackage(package, function(err) {
            if(err) {
                context.log("Got an error processing", package.info.full_name, err)
                package.processing = false
                package.save()
                return
            }
        })
    },

    parsePackageRobot: async function(robot, package) {
        return robotPackage(package, function(err) {
            if(err) {
                robot.log("Got an error processing", package.info.full_name, err)
                package.processing = false
                package.save()
                return
            }
        })
    }
}