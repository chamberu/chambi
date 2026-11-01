# Changelog

## [0.4.1](https://github.com/chamvi/chamvi/compare/v0.4.0...v0.4.1) (2026-11-01)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.4.0 to ^0.4.1
    * @chamvi/test-kit bumped from ^0.4.0 to ^0.4.1
  * peerDependencies
    * @chamvi/core bumped from ^0.4.0 to ^0.4.1

## [0.4.0](https://github.com/chamvi/chamvi/compare/v0.3.1...v0.4.0) (2026-11-01)


### ⚠ BREAKING CHANGES

* **store-db,core:** migrations from the pre-release window are replaced by `ConversationsRunTaint1792713600000`, so recreate or reconcile development databases. Writes for unknown runs reject with `RunNotFoundError`. Upgrading from 0.3 needs downtime, as described in the upgrade guide.
* Node.js 22 is no longer supported. All packages require Node.js >=24.3.0.
* add durable conversation memory and composable repositories ([#96](https://github.com/chamvi/chamvi/issues/96))

### Features

* add agent execution caps and channel HTTP limit policies ([#93](https://github.com/chamvi/chamvi/issues/93)) ([422a9e9](https://github.com/chamvi/chamvi/commit/422a9e9d80a48b0b7b057de51b078c598da7423c))
* add durable conversation memory and composable repositories ([#96](https://github.com/chamvi/chamvi/issues/96)) ([a183f1c](https://github.com/chamvi/chamvi/commit/a183f1c723b573603ee50533dd4ff25fc2efcc20))
* **skills:** add verified agent skills and startup installation ([#94](https://github.com/chamvi/chamvi/issues/94)) ([2c44e21](https://github.com/chamvi/chamvi/commit/2c44e21b57a9263e40ecc10d514079f90aa4ec1f))


### Bug Fixes

* **store-db,core:** bundle the 0.4 migrations and finish the release audit ([#105](https://github.com/chamvi/chamvi/issues/105)) ([d8c671a](https://github.com/chamvi/chamvi/commit/d8c671a0afc81d85b0bcf627206b0cf74f5cb580))


### Build System

* upgrade eslint config to 3.2.0 and require Node 24 ([00fa9b4](https://github.com/chamvi/chamvi/commit/00fa9b463c9e78ec783d3352c8ba8d16b7191758))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.3.1 to ^0.4.0
    * @chamvi/test-kit bumped from ^0.3.1 to ^0.4.0
  * peerDependencies
    * @chamvi/core bumped from ^0.3.1 to ^0.4.0

## [0.3.1](https://github.com/chamvi/chamvi/compare/v0.2.2...v0.3.1) (2026-10-27)


### ⚠ BREAKING CHANGES

* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36))

### Features

* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38)) ([9ce771e](https://github.com/chamvi/chamvi/commit/9ce771ed4255e667d5592e70239ef6f44f937afe))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36)) ([78e8e7e](https://github.com/chamvi/chamvi/commit/78e8e7edc02e21da1dddec493887847eb4e61c7f))


### Bug Fixes

* **deps:** bump the minorandpatch group across 1 directory with 4 updates ([#37](https://github.com/chamvi/chamvi/issues/37)) ([655adfc](https://github.com/chamvi/chamvi/commit/655adfcb7807d233a218fc62458f52e92dda0853))
* ensure consistent version for release ([#67](https://github.com/chamvi/chamvi/issues/67)) ([c08d0fb](https://github.com/chamvi/chamvi/commit/c08d0fbf89c5083f750ed5c966513aad79bbabe6))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.3.0 to ^0.3.1
    * @chamvi/test-kit bumped from ^0.3.0 to ^0.3.1
  * peerDependencies
    * @chamvi/core bumped from ^0.3.0 to ^0.3.1

## [0.2.2](https://github.com/chamvi/chamvi/compare/v0.2.1...v0.2.2) (2026-10-26)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.2.1 to ^0.3.0
    * @chamvi/test-kit bumped from ^0.2.1 to ^0.3.0
  * peerDependencies
    * @chamvi/core bumped from ^0.2.1 to ^0.3.0

## [0.2.1](https://github.com/chamvi/chamvi/compare/v0.2.0...v0.2.1) (2026-10-25)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.2.0 to ^0.2.1
    * @chamvi/test-kit bumped from ^0.2.0 to ^0.2.1
  * peerDependencies
    * @chamvi/core bumped from ^0.2.0 to ^0.2.1

## [0.2.0](https://github.com/chamvi/chamvi/compare/channel-cron-v0.1.0...channel-cron-v0.2.0) (2026-10-25)


### ⚠ BREAKING CHANGES

* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36))

### Features

* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38)) ([9ce771e](https://github.com/chamvi/chamvi/commit/9ce771ed4255e667d5592e70239ef6f44f937afe))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36)) ([78e8e7e](https://github.com/chamvi/chamvi/commit/78e8e7edc02e21da1dddec493887847eb4e61c7f))


### Bug Fixes

* **deps:** bump the minorandpatch group across 1 directory with 4 updates ([#37](https://github.com/chamvi/chamvi/issues/37)) ([655adfc](https://github.com/chamvi/chamvi/commit/655adfcb7807d233a218fc62458f52e92dda0853))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.1.0 to ^0.2.0
    * @chamvi/test-kit bumped from ^0.1.0 to ^0.2.0
  * peerDependencies
    * @chamvi/core bumped from ^0.1.0 to ^0.2.0
