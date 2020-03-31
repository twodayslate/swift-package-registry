var { runCommand } = require('./docker')
var Docker = require('dockerode')
var docker = new Docker()
const { Octokit } = require('@octokit/rest')

const dockerTags = ['swift:5.2', 'swift:5.1', 'swift:5.0', 'swift:4.2', 'swift:4.1', 'swift:4.0', 'swift:3.1', 'swift:latest']

var robotPackage = async function (_package, callback) {
  const personalAccess = new Octokit({
    auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN
  })

  if (!_package.info) {
    var owner
    var repo
    if (_package.full_name) {
      owner = _package.full_name.split('/')[0]
      repo = _package.full_name.split('/')[1]
    }
    personalAccess.repos.get({ owner: owner, repo: repo }).then(async function (repository) {
      _package.info = repository.data
      await _package.save()
      console.log('going to parse', _package.full_name, 'again')
      robotPackage(_package, callback)
    })
    return
  }

  personalAccess.repos.listReleases({ owner: _package.info.owner.login, repo: _package.info.name }).then(async function (releases) {
    var release
    var ref = _package.info.default_branch
    var tarball = _package.info.url + '/tarball'
    releases.data.some(async function (ele) {
      if (!ele.draft && !ele.prerelease) {
        release = ele
        return true
      }
    })
    if (release) {
      ref = release.tag_name
      tarball = release.tarball_url
      if (release.body) {
        const readmemd = await personalAccess.markdown.render({ text: release.body, mode: 'gfm', context: _package.info.full_name })
        release.body = readmemd.data
      }
      _package.latest_release = release
      await _package.save()
    }

    personalAccess.request('GET /repos/:owner/:repo/readme', {
      owner: _package.info.owner.login,
      repo: _package.info.name,
      ref: ref,
      headers: {
        accept: 'application/vnd.github.v3.html'
      }
    }).then(async function (readme) {
      _package.readme = readme.data
      await _package.save()
    }).catch(() => {})

    personalAccess.repos.listTopics({ owner: _package.info.owner.login, repo: _package.info.name }).then(async function (topics) {
      _package.topics = topics.data.names
      _package.save()

      var cb = async function (err, swiftDump, toolsVersion, description, dependencies) {
        if (err) {
          _package.processing = false
          _package.error = err.message || err
          await _package.save()
          return callback(err)
        }

        if (swiftDump) { _package.dump = swiftDump }
        if (toolsVersion) { _package.tools_version = toolsVersion }
        if (description) { _package.description = description }
        if (dependencies) { _package.dependencies = dependencies }
        _package.processing = false
        _package.error = null
        await _package.save()

        callback(null)
      }

      var index = 0

      var loopCallback = async function (err, swiftDump, toolsVersion, description, dependencies) {
        if (err) {
          index = index + 1
          if (index < dockerTags.length) {
            return processTarball(dockerTags[0], tarball, loopCallback)
          } else {
            return cb(err)
          }
        }

        cb(err, swiftDump, toolsVersion, description, dependencies)
      }

      processTarball(dockerTags[0], tarball, loopCallback)
    }).catch(function (err) { callback(err) })
  }).catch(function (err) { callback(err) })
}

var processTarball = async function (tag, tarball, callback) {
  var _container

  var swiftDump
  var toolsVersion
  var description
  var dependencies

  const baseDir = '/usr/src/'
  const packageDir = '/usr/src/package'

  function onError (err) {
    var cb = function () {
      if (err) {
        console.log('done with error', err)
      } else {
        console.log('done :)')
      }

      callback(err, swiftDump, toolsVersion, description, dependencies)
    }

    if (_container) {
      _container.stop(() => {
        _container.remove(() => {
          return cb()
        })
      })
    } else {
      cb()
    }
  }

  function runCommandAndCheck (cmd, dir, cb) {
    runCommand(_container, cmd, dir, function (err, stdout, stderr, inspectData) {
      if (err) {
        return onError(err)
      }
      if (inspectData.ExitCode !== 0) {
        if (inspectData.ProcessConfig.entrypoint === 'timeout' && inspectData.ExitCode === 124) {
          console.log('Got a timeout!', cmd, stdout, stderr, inspectData)
          return onError((stderr || stdout) + '\nTimeout exceeded')
        }

        console.log('exit code not zero when running', cmd, stdout, stderr, inspectData)
        return onError(stderr || stdout)
      }
      cb(stdout, stderr)
    })
  }

  docker.pull(tag, function (err, stream) {
    if (err) {
      return onError(err)
    }

    docker.createContainer({ Image: tag, Cmd: ['/bin/bash'], AutoRemove: true, Tty: true }, function (err, container) {
      if (err) {
        return onError(err)
      }

      _container = container

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
          if (err) {
            onError(err)
            return
          }
          runCommandAndCheck(['apt-get', 'update'], baseDir, function (stdout, stderr) {
            runCommandAndCheck(['apt-get', 'install', '--no-install-recommends', '--yes', 'wget'], baseDir, function (stdout, stderr) {
              runCommandAndCheck(['mkdir', '-p', 'package'], baseDir, function (stdout, stderr) {
                // https://stackoverflow.com/a/8378458/193772
                runCommandAndCheck(['wget', tarball, '--header', 'Authorization: token ' + process.env.GITHUB_PERSONAL_ACCESS_TOKEN, '--header', 'Accept:application/vnd.github.v3.raw', '--output-document=package.tar.gz'], baseDir, function (stdout, stderr) {
                  runCommandAndCheck(['tar', 'xf', 'package.tar.gz', '-C', 'package', '--strip-components=1'], baseDir, function (stdout, stderr) {
                    runCommandAndCheck(['swift', 'package', 'tools-version'], packageDir, function (stdout, stderr) {
                      toolsVersion = stdout.trim()
                      runCommandAndCheck(['swift', 'package', 'describe', '--type=json'], packageDir, function (stdout, stderr) {
                        description = JSON.parse(stdout)
                        // 30 minutes to get dependencies should be more than enough
                        runCommandAndCheck(['timeout', '--signal=ABRT', '1800', 'swift', 'package', 'show-dependencies', '--format=json'], packageDir, function (stdout, stderr) {
                          try {
                            dependencies = JSON.parse(stdout.substr(stdout.indexOf('{')))
                          } catch (err) {
                            onError(err)
                            return
                          }

                          runCommandAndCheck(['swift', 'package', 'dump-package'], packageDir, function (stdout, stderr) {
                            swiftDump = JSON.parse(stdout)
                            onError(null)
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
      } catch (err) {
        return onError(err)
      }
    })
  })
}

module.exports = {
  processTarball: async function (tag, tarball, callback) {
    return processTarball(tag, tarball, callback)
  },

  parsePackageRequest: async function (req, _package) { // this is models.Package
    return robotPackage(_package, function (err) {
      if (err) {
        req.log('Got an error processing', _package.info.full_name, err)
      }
    })
  },

  parsePackageContext: async function (context, _package) {
    return robotPackage(_package, function (err) {
      if (err) {
        context.log('Got an error processing', _package.info.full_name, err)
      }
    })
  },

  parsePackageRobot: async function (robot, _package) {
    return robotPackage(_package, function (err) {
      if (err) {
        robot.log('Got an error processing', _package.info.full_name, err)
      }
    })
  }
}
