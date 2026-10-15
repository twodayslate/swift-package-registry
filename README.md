# Swift Package Registry

[![Node.js CI](https://github.com/twodayslate/swift-package-registry/actions/workflows/nodejs.yml/badge.svg)](https://github.com/twodayslate/swift-package-registry/actions/workflows/nodejs.yml)

The [Swift Package Registry](https://swiftpackageregistry.com/) is a collection of Swift Packages. Since the [GitHub Swift Package Registry](https://github.blog/2019-06-03-github-package-registry-will-support-swift-packages/) is not currently released and the [IBM Swift Package Catalog](https://developer.ibm.com/swift/2016/02/22/introducing-swift-package-catalog/) is has been killed, the [Swift Package Registry](https://swiftpackageregistry.com/) fills the current gap for easier searching and discoverability of Swift Packages.

## Technical

This [GitHub App](https://developer.github.com/apps/about-apps/) is a [Node.js](https://nodejs.org/en/) application built with [Probot](https://github.com/probot/probot). It parses all Swift packages using [Docker](https://github.com/apocas/dockerode). You can help contribue to this project by visiting the [GitHub page](https://github.com/twodayslate/swift-package-registry/). Issues and pull requests are welcomed!

Only public repositories are supported. When adding packages manually, a personal access token is used to fetch information about the package. 

Docker is used to help validate packages. Just parsing <samp>Package.swift</samp> is not always enough. It is also an additional check for Swift version compatability.

You can access the [Swift Package Registry](https://swiftpackageregistry.com/) via [swiftpackageregistry.com](https://swiftpackageregistry.com/) (main site), [swift-packages.com](https://swift-packages.com), [swiftpkg.dev](https://swiftpkg.dev), [SVVlFT.com](https://svvlft.com), and [swiftdependencies.com](https://swiftdependencies.com).

## Repository denylist

Repositories in `repository-denylist.json` are excluded from ingestion and processing.
Add an exact `owner/repository` name to the JSON array; matching is case-insensitive.

The denylist applies to manual submissions, package URLs, GitHub events, and
processing of existing records. Canonical names returned by GitHub are checked too.
It does not delete existing database records or purge cached/listing data.

## Development

### Setup

#### Install dependencies
```sh
npm install
```

Setup <samp>.env</samp>. You can use <samp>.env.exmaple</samp> as a base.

#### Upgrading repository uniqueness

Packages have a named unique index, `packages_github_id_unique`, on `github_id`.
This lets concurrent manual submissions, package requests, and GitHub events use
`findOrCreate` without inserting multiple rows for the same GitHub repository.
The index is added by the existing startup `sequelize.sync({ alter: true })`.
It does not prevent multiple workers from processing the same existing row.

Before upgrading an existing database, stop and drain all writers, take a backup,
and check for duplicate repository IDs:

```sql
SELECT github_id, COUNT(*), ARRAY_AGG(id ORDER BY id) AS package_ids
FROM "Packages"
WHERE github_id IS NOT NULL
GROUP BY github_id
HAVING COUNT(*) > 1;
```

If any groups are returned, do not start the upgraded app yet. Archive the full
rows and review each group before choosing a survivor and merging useful data
(including successful processing results and `is_installed`). Preserve the
survivor's package ID and check for any external references or database foreign
keys before removing reviewed duplicates. This change intentionally does not
choose survivors or delete data automatically; unresolved duplicates make index
creation fail and prevent startup. Nullable legacy IDs are unchanged by this fix.

Once the audit is clear, start the upgraded app to create the index before
resuming other writers. Verify the following returns one row with both flags true:

```sql
SELECT i.relname, ix.indisunique, ix.indisvalid
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
WHERE ix.indrelid = '"Packages"'::regclass
  AND i.relname = 'packages_github_id_unique';
```

Keep the index if rolling back the application: dropping it reintroduces the race,
and rolling back code cannot restore any records an operator merged or removed.

#### Tests

Run `npm test` with `POSTGRESQL_SERVER` pointing to a disposable PostgreSQL
database (the default is `postgres://localhost:5432/spr`). The uniqueness tests
use two independent clients and an isolated temporary schema to reproduce
overlapping inserts, check upgrade failure without data loss, and verify repeated
startup synchronization does not add redundant indexes. The existing app tests
also synchronize tables in the database's default schema.

#### Run the bot
```
npm start
```

*GitHub Action*

```sh
ncc build -o action action.js 
```

For locally testing Swift Package Collections you will need to be using TLS/SSL. This can be achieved with the `https-localhost` npm package and manually modifying probot to use that over it's regular express web server.

### Contributing

If you have suggestions for how Swift Package Registry could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](https://github.com/twodayslate/swift-package-registry/blob/master/CONTRIBUTING.md).
