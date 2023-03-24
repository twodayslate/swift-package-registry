const { NIL } = require('uuid')
const { convert } = require('html-to-text')
const semver = require('semver')
const dateFormat = require('dateformat')

module.exports = function (router) {
  function map_packages (packages) {
    return packages.map(myPackage => {
      // will use 0.0.0 if can't parse semversion
      var version = '0.0.0'
      if (myPackage.latest_release) {
        const newVer = semver.clean(myPackage.latest_release.tag_name.toLowerCase().replace('version', ''))
        if (newVer) {
          version = newVer
        }
      }

      var ans = {
        url: myPackage.info.git_url.replace('git://', 'https://'),
        versions: [
          {
            version: version,
            summary: convert(myPackage.latest_release.body),
            manifests: {
              [myPackage.description.tools_version]: {
                toolsVersion: myPackage.description.tools_version,
                packageName: myPackage.description.name,
                targets: myPackage.description.targets,
                products: myPackage.description.products
              }
            },
            defaultToolsVersion: myPackage.description.tools_version,
            createdAt: dateFormat(myPackage.latest_release.created_at, 'isoDateTime')
          }
        ]
      }
      if (myPackage.info.description) {
        ans.summary = myPackage.info.description
      }
      return ans
    })
  }

  router.get('/collection.json', router.apicache('12 hours'), async function (req, res) {
    const packages = await router.db.Package.findAll({
      where: {
        processing: false,
        latest_release: {
          [router.db.Sequelize.Op.not]: null
        },
        error: null,
        description: {
          [router.db.Sequelize.Op.not]: null
        },
        'description.tools_version': {
          [router.db.Sequelize.Op.not]: null
        }
      },
      order: [['info.stargazers_count', 'DESC']],
      limit: 1000
    })

    req.robot.log('packages:')
    req.robot.log(packages)
    // format https://github.com/apple/swift-package-manager/blob/main/Sources/PackageCollectionsModel/Formats/v1.md
    const ans = JSON.stringify({
      overview: 'A collection of the top 1000 Swift packages on the Swift Package Registry',
      formatVersion: '1.0',
      name: 'Top 1000 Packages from the Swift Package Registry',
      generatedBy: { name: 'The Swift Package Registry' },
      keywords: ['swift package registry'],
      packages: map_packages(packages),
      // 2020-10-22T06:03:52Z format
      generatedAt: dateFormat((new Date()).toISOString(), 'isoDateTime')
    })
    res.setHeader('Content-Length', Buffer.byteLength(ans))
    res.setHeader('Content-Type', 'application/json')
    res.send(ans)
  })

  router.get('/:owner/collection.json', router.apicache('6 hours'), async function (req, res) {
    const packages = await router.db.Package.findAll({
      where: {
        processing: false,
        latest_release: {
          [router.db.Sequelize.Op.not]: null
        },
        error: null,
        description: {
          [router.db.Sequelize.Op.not]: null
        },
        'info.owner.login': req.params.owner,
        'description.tools_version': {
          [router.db.Sequelize.Op.not]: null
        }
      }
    })

    req.robot.log('packages:')
    req.robot.log(packages)
    // format https://github.com/apple/swift-package-manager/blob/main/Sources/PackageCollectionsModel/Formats/v1.md
    const ans = JSON.stringify({
      overview: 'A collection of ' + req.params.owner + "'s Swift packages on the Swift Package Registry",
      formatVersion: '1.0',
      name: req.params.owner + "'s packages from the Swift Package Registry",
      generatedBy: { name: 'The Swift Package Registry' },
      keywords: ['swift package registry', req.params.owner],
      packages: map_packages(packages),
      // 2020-10-22T06:03:52Z format
      generatedAt: dateFormat((new Date()).toISOString(), 'isoDateTime')
    })
    res.setHeader('Content-Length', Buffer.byteLength(ans))
    res.setHeader('Content-Type', 'application/json')
    res.send(ans)
  })
}
