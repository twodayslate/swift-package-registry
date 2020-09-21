var { runCommand, asyncRunCommand } = require('./docker')
var Docker = require('dockerode')
var docker = new Docker()
const { Octokit } = require('@octokit/rest')
const util = require('util');

const dockerTags = ['swift:5.2', 'swift:5.1', 'swift:5.0', 'swift:4.2', 'swift:4.1', 'swift:4.0', 'swift:3.1', 'swift:latest', 'swiftlang/swift:nightly-5.3-bionic', 'swiftlang/swift:nightly-bionic']

var robotPackage = async function (_package, callback) {
  return new Promise(async function(resolve, reject) {
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
      let repository = personalAccess.repos.get({ owner: owner, repo: repo })
      _package.info = repository.data
      await _package.save()
      console.log('going to parse', _package.full_name, 'again')
      return await robotPackage(_package, callback)
    }

    try {
      let releases = await personalAccess.repos.listReleases({ owner: _package.info.owner.login, repo: _package.info.name })
      var release
      var refs = [_package.info.default_branch]
      var tarball = _package.info.url + '/tarball'
      await releases.data.some(async function (ele) {
        if (!ele.draft && !ele.prerelease) {
          release = ele
          return true
        }
      })
      if (release) {
        refs.unshift(release.tag_name)
        tarball = release.tarball_url
        if (release.body) {
          const readmemd = await personalAccess.markdown.render({ text: release.body, mode: 'gfm', context: _package.info.full_name })
          release.body = readmemd.data
        }
        _package.latest_release = release
        await _package.save()
      }

      let readme = await personalAccess.request('GET /repos/:owner/:repo/readme', {
        owner: _package.info.owner.login,
        repo: _package.info.name,
        ref: refs[0],
        headers: {
          accept: 'application/vnd.github.v3.html'
        }
      })
      if (readme) {
        _package.readme = readme.data
        await _package.save()
      }
      
      let topics = await personalAccess.repos.getAllTopics({ owner: _package.info.owner.login, repo: _package.info.name })
      _package.topics = topics.data.names
      await _package.save()

      var cb = async function (err, swiftDump, toolsVersion, description, dependencies) {
        if (swiftDump) { _package.dump = swiftDump }
        if (toolsVersion) { _package.tools_version = toolsVersion }
        if (description) { _package.description = description }
        if (dependencies) { _package.dependencies = dependencies }
        _package.processing = false
        if (err) {
          _package.error = err.message || err
        } else {
          _package.error = null
        }
       
        await _package.save()
        return resolve(_package)
      }

      var index = 0
      var lastErr
      var {swiftDump, toolsVersion, description, dependencies} = {}

      for (var index = 0; index < dockerTags.length; index++) {
        try {
          var {swiftDump, toolsVersion, description, dependencies} = await processSwiftPackage(dockerTags[index], refs[0], _package.info.git_url)
          return await cb(null, swiftDump, toolsVersion, description, dependencies)
          break
        } catch(err) {
          lastErr = err
        }
      }

      return await cb(lastErr, swiftDump, toolsVersion, description, dependencies)
    } catch (err) {
      reject(err)
    }
  })  
}

var processSwiftPackage = async function(docker_tag, branch, clone_url) {
  return new Promise(async function(resolve, reject) {
    console.log("processing swift packge", docker_tag, branch, clone_url)
    var _container

    var swiftDump
    var toolsVersion
    var description
    var dependencies

    const baseDir = '/usr/src/'
    const packageDir = '/usr/src/package'

    async function onError (err) {
      var cb = function () {
        if (err) {
          console.log('done with error', err)
          reject(err)
        } else {
          console.log("done with package processing")
          resolve({swiftDump, toolsVersion, description, dependencies})
        }
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

    async function runCommandAndCheck (cmd, dir) {
      return new Promise(async function(resolve, reject) {
        let {stdout, stderr, data} = await asyncRunCommand(_container, cmd, dir)
        let inspectData = data
        console.log("got stdout, stderr", stdout, stderr, inspectData)
        if (inspectData.ExitCode !== 0) {
          if (inspectData.ProcessConfig.entrypoint === 'timeout' && inspectData.ExitCode === 124) {
            console.log('Got a timeout!', cmd, stdout, stderr, inspectData)
            return reject((stderr || stdout) + '\nTimeout exceeded')
          }

          console.log('exit code not zero when running', cmd, stdout, stderr, inspectData)
          return reject(stderr || stdout)
        }
        resolve({stdout, stderr, data})
      })
    }

    try {
      let stream = await docker.pull(docker_tag)
      let container = await docker.createContainer({ Image: docker_tag, Cmd: ['/bin/bash'], AutoRemove: true, Tty: true })
      await container.start()
      _container = container
      await runCommandAndCheck(['git', 'clone', clone_url, '--recurse-submodules', '--branch', branch, '--single-branch', 'package'], baseDir)
      
      var {stdout, stderr} = await runCommandAndCheck(['swift', 'package', 'tools-version'], packageDir)
      toolsVersion = stdout.trim()
      
      var {stdout, stderr} = await runCommandAndCheck(['swift', 'package', 'describe', '--type=json'], packageDir)
      description = JSON.parse(stdout)
      
      var {stdout, stderr} = await runCommandAndCheck(['timeout', '--signal=ABRT', '1800', 'swift', 'package', 'show-dependencies', '--format=json'], packageDir)
      dependencies = JSON.parse(stdout.substr(stdout.indexOf('{')))

      var {stdout, stderr} = await runCommandAndCheck(['swift', 'package', 'dump-package'], packageDir)
      swiftDump = JSON.parse(stdout)
    } catch(err) {
      return await onError(err)
    }

    return await onError(null)
  })
}

module.exports = {
  parsePackageRequest: async function (req, _package) { // this is models.Package
    console.log("parsing package request")
    return robotPackage(_package, function (err) {
      if (err) {
        console.log('Got an error processing', _package.info.full_name, err)
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
