var { asyncRunCommand } = require('./docker')
var Docker = require('dockerode')
var docker = new Docker()
const { Octokit } = require('@octokit/rest')
const apicache = require('apicache')
const absolutify = require('absolutify')

const dockerTags = ['swift:latest', 'swift:5.9', 'swift:5.6', 'swift:5.4', 'swift:5.2', 'swift:5.0', 'swift:4.2']

var robotPackage = async function (_package, callback) {
  console.log('robotPackage: start', _package && _package.info ? _package.info.full_name : _package)

  const personalAccess = new Octokit({
    auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN
  })

  try {
    console.log('robotPackage: checking docker daemon')
    await docker.ping()
    console.log('robotPackage: docker daemon reachable')
  } catch (err) {
    console.error('robotPackage: docker daemon not reachable', err)
    throw err
  }

  if (!_package.info) {
    var owner
    var repo
    if (_package.full_name) {
      owner = _package.full_name.split('/')[0]
      repo = _package.full_name.split('/')[1]
    }
    const repository = await personalAccess.repos.get({ owner: owner, repo: repo })
    _package.info = repository.data
    await _package.save()
    console.log('going to parse', _package.full_name, 'again')
    return await robotPackage(_package, callback)
  }

  try {
    console.log('trying for', _package.info.name)
    const releases = await personalAccess.repos.listReleases({ owner: _package.info.owner.login, repo: _package.info.name })
    var release
    var refs = [_package.info.default_branch]

    releases.data.some(function (ele) {
      if (!ele.draft && !ele.prerelease) {
        release = ele
        return true
      }
    })

    if (release) {
      refs.unshift(release.tag_name)
      if (release.body) {
        const readmemd = await personalAccess.markdown.render({ text: release.body, mode: 'gfm', context: _package.info.full_name })
        release.body = readmemd.data
      }
      _package.latest_release = release
      await _package.save()
    }

    try {
      const readme = await personalAccess.request('GET /repos/:owner/:repo/readme', {
        owner: _package.info.owner.login,
        repo: _package.info.name,
        ref: refs[0],
        headers: {
          accept: 'application/vnd.github.v3.html'
        }
      })
      if (readme) {
        _package.readme = absolutify(readme.data, function (url, attrName) {
          // images need to point to the raw asset while everything else can point
          // to the blob
          if (attrName !== 'src') {
            return _package.info.html_url + '/blob/' + refs[0] + url
          }
          return _package.info.html_url + '/raw/' + refs[0] + url
        })
        await _package.save()
      }
    } catch (err) {
      // package does not have a readme
    }

    const topics = await personalAccess.repos.getAllTopics({ owner: _package.info.owner.login, repo: _package.info.name })
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
      return _package
    }

    var lastErr
    var resultData = {}

    console.log('robotPackage: starting docker processing for', _package.info.full_name)
    for (var index = 0; index < dockerTags.length; index++) {
      try {
        console.log('robotPackage: trying docker tag', dockerTags[index], 'ref', refs[0])
        resultData = await processSwiftPackage(dockerTags[index], refs[0], _package.info.git_url.replace('git://', 'https://'))
        return await cb(null, resultData.swiftDump, resultData.toolsVersion, resultData.description, resultData.dependencies)
      } catch (err) {
        console.error('robotPackage: docker tag failed', dockerTags[index], err)
        lastErr = err
      }
    }

    return await cb(lastErr, resultData.swiftDump, resultData.toolsVersion, resultData.description, resultData.dependencies)
  } catch (err) {
    console.log('robotPackage: got an error in robotPackage', err)
    throw err
  }
}

var processSwiftPackage = async function (dockerTag, branch, cloneUrl) {
  console.log('processing swift package', dockerTag, branch, cloneUrl)
  var _container

  var swiftDump
  var toolsVersion
  var description
  var dependencies

  const baseDir = '/usr/src/'
  const packageDir = '/usr/src/package'

  async function cleanup (err) {
    if (_container) {
      try {
        await new Promise((resolve) => {
          _container.stop(() => {
            _container.remove(() => {
              resolve()
            })
          })
        })
      } catch (cleanupErr) {
        console.log('Error during cleanup:', cleanupErr)
      }
    }

    if (err) {
      console.log('done with error', err)
      throw err
    } else {
      console.log('done with package processing')
      return { swiftDump, toolsVersion, description, dependencies }
    }
  }

  async function runCommandAndCheck (cmd, dir, acceptAnyways) {
    const { stdout, stderr, data } = await asyncRunCommand(_container, cmd, dir)
    const inspectData = data
    console.log('got stdout, stderr', stdout, stderr, inspectData)

    if (inspectData.ExitCode !== 0) {
      if (inspectData.ProcessConfig.entrypoint === 'timeout' && inspectData.ExitCode === 124) {
        console.log('Got a timeout!', cmd, stdout, stderr, inspectData)
        if (!acceptAnyways) {
          throw new Error((stderr || stdout) + '\nTimeout exceeded')
        }
      }

      console.log('exit code not zero when running', cmd, stdout, stderr, inspectData)
      if (!acceptAnyways) {
        throw new Error(stderr || stdout)
      }
    }
    return { stdout, stderr, data }
  }

  try {
    console.log('processSwiftPackage: pulling docker image', dockerTag)
    await docker.pull(dockerTag)
    console.log('processSwiftPackage: creating container', dockerTag)
    const container = await docker.createContainer({ Image: dockerTag, Cmd: ['/bin/bash'], AutoRemove: true, Tty: true, platform: 'linux/amd64' })
    await container.start()
    console.log('processSwiftPackage: container started', container.id)
    _container = container
    await runCommandAndCheck(['git', 'clone', cloneUrl, '--recurse-submodules', '--branch', branch, '--single-branch', 'package'], baseDir)

    const toolsResult = await runCommandAndCheck(['swift', 'package', 'tools-version'], packageDir)
    toolsVersion = toolsResult.stdout.trim()

    await runCommandAndCheck(['timeout', '--signal=ABRT', '1800', 'swift', 'package', 'resolve'], packageDir, true)

    const describeResult = await runCommandAndCheck(['swift', 'package', 'describe', '--type=json'], packageDir, true)
    try {
      description = JSON.parse(describeResult.stdout)
    } catch (err) {
      // ignore JSON parse errors
    }

    const dependenciesResult = await runCommandAndCheck(['timeout', '--signal=ABRT', '1800', 'swift', 'package', 'show-dependencies', '--format=json'], packageDir)
    dependencies = JSON.parse(dependenciesResult.stdout.substr(dependenciesResult.stdout.indexOf('{')))

    const dumpResult = await runCommandAndCheck(['swift', 'package', 'dump-package'], packageDir)
    swiftDump = JSON.parse(dumpResult.stdout)
  } catch (err) {
    return await cleanup(err)
  }

  // clear the cache so we get the new package
  apicache.clear()
  return await cleanup(null)
}

module.exports = {
  parsePackageRequest: async function (req, _package) { // this is models.Package
    console.log('parsing package request', _package && _package.info ? _package.info.full_name : _package)
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
