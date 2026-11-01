# Changelog

## [0.4.1](https://github.com/chamvi/chamvi/compare/v0.4.0...v0.4.1) (2026-11-01)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/app bumped from ^0.4.0 to ^0.4.1
    * @chamvi/core bumped from ^0.4.0 to ^0.4.1
  * peerDependencies
    * @chamvi/app bumped from ^0.4.0 to ^0.4.1
    * @chamvi/core bumped from ^0.4.0 to ^0.4.1

## [0.4.0](https://github.com/chamvi/chamvi/compare/v0.3.1...v0.4.0) (2026-11-01)


### ⚠ BREAKING CHANGES

* harden trust gates, github, sandbox and coding before 0.4 ([#104](https://github.com/chamvi/chamvi/issues/104))
* Node.js 22 is no longer supported. All packages require Node.js >=24.3.0.
* add durable conversation memory and composable repositories ([#96](https://github.com/chamvi/chamvi/issues/96))
* **sandbox:** use bash-first workspace credentials ([#87](https://github.com/chamvi/chamvi/issues/87))

### Features

* add durable conversation memory and composable repositories ([#96](https://github.com/chamvi/chamvi/issues/96)) ([a183f1c](https://github.com/chamvi/chamvi/commit/a183f1c723b573603ee50533dd4ff25fc2efcc20))
* gate untrusted runs and add allowlisted file proposals ([#101](https://github.com/chamvi/chamvi/issues/101)) ([d49d07f](https://github.com/chamvi/chamvi/commit/d49d07f7b3555100857207abe778ce238b2cfe49))
* load scoped repository instructions ([#95](https://github.com/chamvi/chamvi/issues/95)) ([5d93bbb](https://github.com/chamvi/chamvi/commit/5d93bbba451f0af9af9809540cfacf8496fd4108))


### Bug Fixes

* harden trust gates, github, sandbox and coding before 0.4 ([#104](https://github.com/chamvi/chamvi/issues/104)) ([1fccd8a](https://github.com/chamvi/chamvi/commit/1fccd8afcc4b122e875c47b0bcf45d65d4b9cd9a))
* **sandbox:** use bash-first workspace credentials ([#87](https://github.com/chamvi/chamvi/issues/87)) ([1731c74](https://github.com/chamvi/chamvi/commit/1731c74ebe8f876bb8c3749df8643e588a1111cc))


### Build System

* upgrade eslint config to 3.2.0 and require Node 24 ([00fa9b4](https://github.com/chamvi/chamvi/commit/00fa9b463c9e78ec783d3352c8ba8d16b7191758))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/app bumped from ^0.3.1 to ^0.4.0
    * @chamvi/core bumped from ^0.3.1 to ^0.4.0
  * peerDependencies
    * @chamvi/app bumped from ^0.3.1 to ^0.4.0
    * @chamvi/core bumped from ^0.3.1 to ^0.4.0

## [0.3.1](https://github.com/chamvi/chamvi/compare/v0.3.0...v0.3.1) (2026-10-27)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/app bumped from ^0.3.0 to ^0.3.1
    * @chamvi/core bumped from ^0.3.0 to ^0.3.1
  * peerDependencies
    * @chamvi/app bumped from ^0.3.0 to ^0.3.1
    * @chamvi/core bumped from ^0.3.0 to ^0.3.1

## [0.3.0](https://github.com/chamvi/chamvi/compare/v0.2.1...v0.3.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **sandbox:** safe workspace defaults and credential redaction fixes ([#60](https://github.com/chamvi/chamvi/issues/60))
* **app:** resolve models through declared providers and add chamvi doctor ([#58](https://github.com/chamvi/chamvi/issues/58))
* **coding:** stateful shell, background jobs, full output, ripgrep search, glob and multi_edit ([#49](https://github.com/chamvi/chamvi/issues/49))
* **sandbox:** root workspaces, any image, a shared package cache and sandbox-dev ([#48](https://github.com/chamvi/chamvi/issues/48))
* **sandbox:** find workspaces again across approvals, restarts and replicas ([#47](https://github.com/chamvi/chamvi/issues/47))

### Features

* **app:** resolve models through declared providers and add chamvi doctor ([#58](https://github.com/chamvi/chamvi/issues/58)) ([04309b9](https://github.com/chamvi/chamvi/commit/04309b93b217c270639d0951eb1d5f00009d4ce0))
* **coding:** stateful shell, background jobs, full output, ripgrep search, glob and multi_edit ([#49](https://github.com/chamvi/chamvi/issues/49)) ([eef86ba](https://github.com/chamvi/chamvi/commit/eef86bafc35ee49651a5053cf64eb0ca70583853))
* **core:** add an engine model resolver and an optional agent model ([#57](https://github.com/chamvi/chamvi/issues/57)) ([d279e52](https://github.com/chamvi/chamvi/commit/d279e52834bc2f6b83edfac2d51b7cc84ea8bb29))
* **sandbox:** find workspaces again across approvals, restarts and replicas ([#47](https://github.com/chamvi/chamvi/issues/47)) ([0f9bcb3](https://github.com/chamvi/chamvi/commit/0f9bcb3c0055be8730050365afb1693a1a3cc512))
* **sandbox:** full git checkouts, pluggable credentials and git tools with a push policy ([#50](https://github.com/chamvi/chamvi/issues/50)) ([9f457bb](https://github.com/chamvi/chamvi/commit/9f457bb7ca64be5e90ebafbe840e6698f156d6f1))
* **sandbox:** root workspaces, any image, a shared package cache and sandbox-dev ([#48](https://github.com/chamvi/chamvi/issues/48)) ([b7131c0](https://github.com/chamvi/chamvi/commit/b7131c0e58fe8c5e2e88bd34248f6208517d9159))


### Bug Fixes

* **sandbox:** safe workspace defaults and credential redaction fixes ([#60](https://github.com/chamvi/chamvi/issues/60)) ([ce751fc](https://github.com/chamvi/chamvi/commit/ce751fc3bafb639d3a8932f3f6e3ca57c2d60417))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/app bumped from ^0.2.1 to ^0.3.0
    * @chamvi/core bumped from ^0.2.1 to ^0.3.0
  * peerDependencies
    * @chamvi/app bumped from ^0.2.1 to ^0.3.0
    * @chamvi/core bumped from ^0.2.1 to ^0.3.0

## [0.2.1](https://github.com/chamvi/chamvi/compare/v0.2.0...v0.2.1) (2026-10-25)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/app bumped from ^0.2.0 to ^0.2.1
    * @chamvi/core bumped from ^0.2.0 to ^0.2.1
  * peerDependencies
    * @chamvi/app bumped from ^0.2.0 to ^0.2.1
    * @chamvi/core bumped from ^0.2.0 to ^0.2.1

## [0.2.0](https://github.com/chamvi/chamvi/compare/sandbox-v0.1.0...sandbox-v0.2.0) (2026-10-25)


### ⚠ BREAKING CHANGES

* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36))
* rename chamberu to chamvi ([#22](https://github.com/chamvi/chamvi/issues/22))

### Features

* add @chamvi/app and @chamvi/cli ([#29](https://github.com/chamvi/chamvi/issues/29)) ([b6f618f](https://github.com/chamvi/chamvi/commit/b6f618f1fbefe76d7afa075d2e644bf1745c7c98))
* add sandboxes, workspaces and coding tools ([#20](https://github.com/chamvi/chamvi/issues/20)) ([beb468e](https://github.com/chamvi/chamvi/commit/beb468e24ecbf968384445fa70e3f9d8dd26f3cf))
* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38)) ([9ce771e](https://github.com/chamvi/chamvi/commit/9ce771ed4255e667d5592e70239ef6f44f937afe))
* rename chamberu to chamvi ([#22](https://github.com/chamvi/chamvi/issues/22)) ([8c049d9](https://github.com/chamvi/chamvi/commit/8c049d9861daa97640b2307f8481f06bab4cef9c))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36)) ([78e8e7e](https://github.com/chamvi/chamvi/commit/78e8e7edc02e21da1dddec493887847eb4e61c7f))


### Bug Fixes

* **deps:** bump the minorandpatch group across 1 directory with 4 updates ([#37](https://github.com/chamvi/chamvi/issues/37)) ([655adfc](https://github.com/chamvi/chamvi/commit/655adfcb7807d233a218fc62458f52e92dda0853))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/app bumped from ^0.1.0 to ^0.2.0
    * @chamvi/core bumped from ^0.1.0 to ^0.2.0
  * peerDependencies
    * @chamvi/app bumped from ^0.1.0 to ^0.2.0
    * @chamvi/core bumped from ^0.1.0 to ^0.2.0
