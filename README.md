# Swift Package Registry

[![Node.js CI](https://github.com/twodayslate/swift-package-registry/workflows/Node.js%20CI/badge.svg)](https://github.com/twodayslate/swift-package-registry/actions?query=workflow%3A%22Node.js+CI%22)

The [Swift Package Registry](https://swiftpackageregistry.com/) is a collection of Swift Packages. Since the [GitHub Swift Package Registry](https://github.blog/2019-06-03-github-package-registry-will-support-swift-packages/) is not currently released and the [IBM Swift Package Catalog](https://developer.ibm.com/swift/2016/02/22/introducing-swift-package-catalog/) is has been killed, the [Swift Package Registry](https://swiftpackageregistry.com/) fills the current gap for easier searching and discoverability of Swift Packages.

## Technical

This [GitHub App](https://developer.github.com/apps/about-apps/) is a [Node.js](https://nodejs.org/en/) application built with [Probot](https://github.com/probot/probot). It parses all Swift packages using [Docker](https://github.com/apocas/dockerode). You can help contribue to this project by visiting the [GitHub page](https://github.com/twodayslate/swift-package-registry/). Issues and pull requests are welcomed!

Only public repositories are supported. When adding packages manually, a personal access token is used to fetch information about the package. 

Docker is used to help validate packages. Just parsing <samp>Package.swift</samp> is not always enough. It is also an additional check for Swift version compatability.

You can access the [Swift Package Registry](https://swiftpackageregistry.com/) via [swiftpackageregistry.com](https://swiftpackageregistry.com/) (main site), [swift-packages.com](https://swift-packages.com), [swiftpkg.dev](https://swiftpkg.dev), [SVVlFT.com](https://svvlft.com), and [swiftdependencies.com](https://swiftdependencies.com).

## Development

### Setup

#### Install dependencies

The node version used is defined. Set it using: 
```sh
nvm use
```

Then install the dependencies:
```sh
npm install
```

Setup <samp>.env</samp>. You can use <samp>.env.exmaple</samp> as a base.

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
