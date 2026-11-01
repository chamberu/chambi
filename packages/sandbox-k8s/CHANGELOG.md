# Changelog

## [0.4.0](https://github.com/chamvi/chamvi/compare/v0.3.1...v0.4.0) (2026-11-01)


### ⚠ BREAKING CHANGES

* Node.js 22 is no longer supported. All packages require Node.js >=24.3.0.

### Build System

* upgrade eslint config to 3.2.0 and require Node 24 ([00fa9b4](https://github.com/chamvi/chamvi/commit/00fa9b463c9e78ec783d3352c8ba8d16b7191758))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.3.1 to ^0.4.0
    * @chamvi/sandbox bumped from ^0.3.1 to ^0.4.0
    * @chamvi/test-kit bumped from ^0.3.1 to ^0.4.0
  * peerDependencies
    * @chamvi/core bumped from ^0.3.1 to ^0.4.0
    * @chamvi/sandbox bumped from ^0.3.1 to ^0.4.0

## [0.3.1](https://github.com/chamvi/chamvi/compare/v0.3.0...v0.3.1) (2026-10-27)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.3.0 to ^0.3.1
    * @chamvi/sandbox bumped from ^0.3.0 to ^0.3.1
    * @chamvi/test-kit bumped from ^0.3.0 to ^0.3.1
  * peerDependencies
    * @chamvi/core bumped from ^0.3.0 to ^0.3.1
    * @chamvi/sandbox bumped from ^0.3.0 to ^0.3.1

## [0.3.0](https://github.com/chamvi/chamvi/compare/v0.2.1...v0.3.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **sandbox:** safe workspace defaults and credential redaction fixes ([#60](https://github.com/chamvi/chamvi/issues/60))
* **coding:** stateful shell, background jobs, full output, ripgrep search, glob and multi_edit ([#49](https://github.com/chamvi/chamvi/issues/49))
* **sandbox:** root workspaces, any image, a shared package cache and sandbox-dev ([#48](https://github.com/chamvi/chamvi/issues/48))
* **sandbox:** find workspaces again across approvals, restarts and replicas ([#47](https://github.com/chamvi/chamvi/issues/47))

### Features

* **coding:** stateful shell, background jobs, full output, ripgrep search, glob and multi_edit ([#49](https://github.com/chamvi/chamvi/issues/49)) ([eef86ba](https://github.com/chamvi/chamvi/commit/eef86bafc35ee49651a5053cf64eb0ca70583853))
* **sandbox:** find workspaces again across approvals, restarts and replicas ([#47](https://github.com/chamvi/chamvi/issues/47)) ([0f9bcb3](https://github.com/chamvi/chamvi/commit/0f9bcb3c0055be8730050365afb1693a1a3cc512))
* **sandbox:** full git checkouts, pluggable credentials and git tools with a push policy ([#50](https://github.com/chamvi/chamvi/issues/50)) ([9f457bb](https://github.com/chamvi/chamvi/commit/9f457bb7ca64be5e90ebafbe840e6698f156d6f1))
* **sandbox:** root workspaces, any image, a shared package cache and sandbox-dev ([#48](https://github.com/chamvi/chamvi/issues/48)) ([b7131c0](https://github.com/chamvi/chamvi/commit/b7131c0e58fe8c5e2e88bd34248f6208517d9159))


### Bug Fixes

* **sandbox:** safe workspace defaults and credential redaction fixes ([#60](https://github.com/chamvi/chamvi/issues/60)) ([ce751fc](https://github.com/chamvi/chamvi/commit/ce751fc3bafb639d3a8932f3f6e3ca57c2d60417))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.2.1 to ^0.3.0
    * @chamvi/sandbox bumped from ^0.2.1 to ^0.3.0
    * @chamvi/test-kit bumped from ^0.2.1 to ^0.3.0
  * peerDependencies
    * @chamvi/core bumped from ^0.2.1 to ^0.3.0
    * @chamvi/sandbox bumped from ^0.2.1 to ^0.3.0

## [0.2.1](https://github.com/chamvi/chamvi/compare/v0.2.0...v0.2.1) (2026-10-25)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.2.0 to ^0.2.1
    * @chamvi/sandbox bumped from ^0.2.0 to ^0.2.1
    * @chamvi/test-kit bumped from ^0.2.0 to ^0.2.1
  * peerDependencies
    * @chamvi/core bumped from ^0.2.0 to ^0.2.1
    * @chamvi/sandbox bumped from ^0.2.0 to ^0.2.1

## [0.2.0](https://github.com/chamvi/chamvi/compare/sandbox-k8s-v0.1.0...sandbox-k8s-v0.2.0) (2026-10-25)


### ⚠ BREAKING CHANGES

* rename chamberu to chamvi ([#22](https://github.com/chamvi/chamvi/issues/22))

### Features

* add sandboxes, workspaces and coding tools ([#20](https://github.com/chamvi/chamvi/issues/20)) ([beb468e](https://github.com/chamvi/chamvi/commit/beb468e24ecbf968384445fa70e3f9d8dd26f3cf))
* rename chamberu to chamvi ([#22](https://github.com/chamvi/chamvi/issues/22)) ([8c049d9](https://github.com/chamvi/chamvi/commit/8c049d9861daa97640b2307f8481f06bab4cef9c))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.1.0 to ^0.2.0
    * @chamvi/sandbox bumped from ^0.1.0 to ^0.2.0
    * @chamvi/test-kit bumped from ^0.1.0 to ^0.2.0
  * peerDependencies
    * @chamvi/core bumped from ^0.1.0 to ^0.2.0
    * @chamvi/sandbox bumped from ^0.1.0 to ^0.2.0
