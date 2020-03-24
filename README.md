## Swift Package Registry

The [Swift Package Registry](https://swiftpackageregistry.com/) is a collection of Swift Packages. Since the [GitHub Swift Package Registry](https://github.blog/2019-06-03-github-package-registry-will-support-swift-packages/) is not currently released and the [IBM Swift Package Catalog](https://developer.ibm.com/swift/2016/02/22/introducing-swift-package-catalog/) is has been killed, the [Swift Package Registry](https://swiftpackageregistry.com/) fills the current gap for easier searching and discoverability of Swift Packages.

### Technical

This website is written in [Node.js](https://nodejs.org/en/) and parses all packages using [Docker](https://github.com/apocas/dockerode). You can help contribue to this project by visiting the [GitHub page](https://github.com/twodayslate/swift-package-registry/). Issues and pull requests are welcomed!

Docker is used to help validate packages. Just parsing <samp>Package.swift</samp> is not always enough. It is also an additional check for Swift version compatability.

You can access the [Swift Package Registry](https://swiftpackageregistry.com/) via [swiftpackageregistry.com](https://swiftpackageregistry.com/) (main site), [swift-packages.com](https://swift-packages.com), [swiftpkg.dev](https://swiftpkg.dev), [SVVlFT.com](https://svvlft.com), and [swiftdependencies.com](https://swiftdependencies.com).