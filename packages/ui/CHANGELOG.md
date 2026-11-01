# Changelog

## [0.4.0](https://github.com/chamvi/chamvi/compare/v0.3.1...v0.4.0) (2026-11-01)


### ⚠ BREAKING CHANGES

* **store-db,core:** migrations from the pre-release window are replaced by `ConversationsRunTaint1792713600000`, so recreate or reconcile development databases. Writes for unknown runs reject with `RunNotFoundError`. Upgrading from 0.3 needs downtime, as described in the upgrade guide.
* Node.js 22 is no longer supported. All packages require Node.js >=24.3.0.
* add durable conversation memory and composable repositories ([#96](https://github.com/chamvi/chamvi/issues/96))

### Features

* add durable conversation memory and composable repositories ([#96](https://github.com/chamvi/chamvi/issues/96)) ([a183f1c](https://github.com/chamvi/chamvi/commit/a183f1c723b573603ee50533dd4ff25fc2efcc20))
* gate untrusted runs and add allowlisted file proposals ([#101](https://github.com/chamvi/chamvi/issues/101)) ([d49d07f](https://github.com/chamvi/chamvi/commit/d49d07f7b3555100857207abe778ce238b2cfe49))


### Bug Fixes

* **deps:** bump authup to 1.0.0-beta.72, vuecs, ilingo, vueuse 15, nx 24 and @types/node 26 ([0582ff2](https://github.com/chamvi/chamvi/commit/0582ff263dc48d7d339dbccf51d4fc7c68bb744f))
* **store-db,core:** bundle the 0.4 migrations and finish the release audit ([#105](https://github.com/chamvi/chamvi/issues/105)) ([d8c671a](https://github.com/chamvi/chamvi/commit/d8c671a0afc81d85b0bcf627206b0cf74f5cb580))


### Build System

* upgrade eslint config to 3.2.0 and require Node 24 ([00fa9b4](https://github.com/chamvi/chamvi/commit/00fa9b463c9e78ec783d3352c8ba8d16b7191758))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/app bumped from ^0.3.1 to ^0.4.0
    * @chamvi/channel-cron bumped from ^0.3.1 to ^0.4.0
    * @chamvi/core bumped from ^0.3.1 to ^0.4.0
    * @chamvi/http bumped from ^0.3.1 to ^0.4.0
    * @chamvi/test-kit bumped from ^0.3.1 to ^0.4.0
  * peerDependencies
    * @chamvi/app bumped from ^0.3.1 to ^0.4.0
    * @chamvi/core bumped from ^0.3.1 to ^0.4.0
    * @chamvi/http bumped from ^0.3.1 to ^0.4.0

## [0.3.1](https://github.com/chamvi/chamvi/compare/v0.3.0...v0.3.1) (2026-10-27)


### Features

* **core:** approvals with options ([#65](https://github.com/chamvi/chamvi/issues/65)) ([994da69](https://github.com/chamvi/chamvi/commit/994da698399a0b3c08e7aa9d3d4a55f82ff23169))
* **core:** start runs of the same agent from a tool ([#64](https://github.com/chamvi/chamvi/issues/64)) ([083c385](https://github.com/chamvi/chamvi/commit/083c3852f1a0c494193e9e6ae36ca5739d1b275c))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/app bumped from ^0.3.0 to ^0.3.1
    * @chamvi/channel-cron bumped from ^0.2.2 to ^0.3.1
    * @chamvi/core bumped from ^0.3.0 to ^0.3.1
    * @chamvi/http bumped from ^0.2.2 to ^0.3.1
    * @chamvi/test-kit bumped from ^0.3.0 to ^0.3.1
  * peerDependencies
    * @chamvi/app bumped from ^0.3.0 to ^0.3.1
    * @chamvi/core bumped from ^0.3.0 to ^0.3.1
    * @chamvi/http bumped from ^0.2.2 to ^0.3.1

## [0.3.0](https://github.com/chamvi/chamvi/compare/v0.2.1...v0.3.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **app:** resolve models through declared providers and add chamvi doctor ([#58](https://github.com/chamvi/chamvi/issues/58))

### Features

* **app:** resolve models through declared providers and add chamvi doctor ([#58](https://github.com/chamvi/chamvi/issues/58)) ([04309b9](https://github.com/chamvi/chamvi/commit/04309b93b217c270639d0951eb1d5f00009d4ce0))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/app bumped from ^0.2.1 to ^0.3.0
    * @chamvi/channel-cron bumped from ^0.2.1 to ^0.2.2
    * @chamvi/core bumped from ^0.2.1 to ^0.3.0
    * @chamvi/http bumped from ^0.2.1 to ^0.2.2
    * @chamvi/test-kit bumped from ^0.2.1 to ^0.3.0
  * peerDependencies
    * @chamvi/app bumped from ^0.2.1 to ^0.3.0
    * @chamvi/core bumped from ^0.2.1 to ^0.3.0
    * @chamvi/http bumped from ^0.2.1 to ^0.2.2

## [0.2.1](https://github.com/chamvi/chamvi/compare/v0.2.0...v0.2.1) (2026-10-25)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/app bumped from ^0.2.0 to ^0.2.1
    * @chamvi/channel-cron bumped from ^0.2.0 to ^0.2.1
    * @chamvi/core bumped from ^0.2.0 to ^0.2.1
    * @chamvi/http bumped from ^0.2.0 to ^0.2.1
    * @chamvi/test-kit bumped from ^0.2.0 to ^0.2.1
  * peerDependencies
    * @chamvi/app bumped from ^0.2.0 to ^0.2.1
    * @chamvi/core bumped from ^0.2.0 to ^0.2.1
    * @chamvi/http bumped from ^0.2.0 to ^0.2.1

## [0.2.0](https://github.com/chamvi/chamvi/compare/ui-v0.1.0...ui-v0.2.0) (2026-10-25)


### ⚠ BREAKING CHANGES

* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36))
* add agent folders and a live agent registry ([#34](https://github.com/chamvi/chamvi/issues/34))

### Features

* add @chamvi/app and @chamvi/cli ([#29](https://github.com/chamvi/chamvi/issues/29)) ([b6f618f](https://github.com/chamvi/chamvi/commit/b6f618f1fbefe76d7afa075d2e644bf1745c7c98))
* add agent folders and a live agent registry ([#34](https://github.com/chamvi/chamvi/issues/34)) ([fe96152](https://github.com/chamvi/chamvi/commit/fe9615226c3ca2af96457d9fa9ffa03dc46c20b2))
* add the web ui ([#25](https://github.com/chamvi/chamvi/issues/25)) ([27d7642](https://github.com/chamvi/chamvi/commit/27d7642abb3faeefddde3153bc4a72f15c6afac6))
* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38)) ([9ce771e](https://github.com/chamvi/chamvi/commit/9ce771ed4255e667d5592e70239ef6f44f937afe))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36)) ([78e8e7e](https://github.com/chamvi/chamvi/commit/78e8e7edc02e21da1dddec493887847eb4e61c7f))
* switch to self-hosted instrument sans and jetbrains mono ([7942db1](https://github.com/chamvi/chamvi/commit/7942db125d6e2325f665503403dfa71381303e88))


### Bug Fixes

* **deps:** bump the minorandpatch group across 1 directory with 4 updates ([#37](https://github.com/chamvi/chamvi/issues/37)) ([655adfc](https://github.com/chamvi/chamvi/commit/655adfcb7807d233a218fc62458f52e92dda0853))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/app bumped from ^0.1.0 to ^0.2.0
    * @chamvi/channel-cron bumped from ^0.1.0 to ^0.2.0
    * @chamvi/core bumped from ^0.1.0 to ^0.2.0
    * @chamvi/http bumped from ^0.1.0 to ^0.2.0
    * @chamvi/test-kit bumped from ^0.1.0 to ^0.2.0
  * peerDependencies
    * @chamvi/app bumped from ^0.1.0 to ^0.2.0
    * @chamvi/core bumped from ^0.1.0 to ^0.2.0
    * @chamvi/http bumped from ^0.1.0 to ^0.2.0
