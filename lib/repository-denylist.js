const deniedRepositories = new Set(require('../repository-denylist.json').map(name => name.toLowerCase()))

module.exports = function isRepositoryDenied (fullName) {
  return typeof fullName === 'string' && deniedRepositories.has(fullName.toLowerCase())
}
