const { Transaction } = require('sequelize')

module.exports = async function findOrCreatePackage (Package, githubId, info) {
  return Package.sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async transaction => {
    // All ingestion paths must take this transaction-scoped lock before reading.
    // Canonicalize IDs in PostgreSQL, without rounding bigint strings in JavaScript.
    // Hash collisions only serialize unrelated repositories; they do not merge them.
    await Package.sequelize.query(
      "SELECT pg_advisory_xact_lock(hashtext('swift-package-registry:Package.github_id'), hashtext(COALESCE(CAST($1 AS bigint)::text, 'null')))",
      { bind: [githubId], transaction }
    )

    // A separate READ COMMITTED statement sees a preceding lock holder's commit.
    // Keep existing duplicates intact and consistently use the oldest package ID.
    const existing = await Package.findOne({
      where: { github_id: githubId },
      order: [['id', 'ASC']],
      transaction
    })
    if (existing) return [existing, false]

    const created = await Package.create({ github_id: githubId, info }, { transaction })
    return [created, true]
  })
}
