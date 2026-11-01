# Changelog

## [0.4.1](https://github.com/chamvi/chamvi/compare/v0.4.0...v0.4.1) (2026-11-01)


### Features

* **core,app:** resolve embedding models ([#107](https://github.com/chamvi/chamvi/issues/107)) ([d0e56b4](https://github.com/chamvi/chamvi/commit/d0e56b46c814037b55117e7163fa482dbb49519b))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.4.0 to ^0.4.1
  * peerDependencies
    * @chamvi/core bumped from ^0.4.0 to ^0.4.1

## [0.4.0](https://github.com/chamvi/chamvi/compare/v0.3.1...v0.4.0) (2026-11-01)


### ⚠ BREAKING CHANGES

* **store-db,core:** migrations from the pre-release window are replaced by `ConversationsRunTaint1792713600000`, so recreate or reconcile development databases. Writes for unknown runs reject with `RunNotFoundError`. Upgrading from 0.3 needs downtime, as described in the upgrade guide.
* Node.js 22 is no longer supported. All packages require Node.js >=24.3.0.
* add durable conversation memory and composable repositories ([#96](https://github.com/chamvi/chamvi/issues/96))

### Features

* add durable conversation memory and composable repositories ([#96](https://github.com/chamvi/chamvi/issues/96)) ([a183f1c](https://github.com/chamvi/chamvi/commit/a183f1c723b573603ee50533dd4ff25fc2efcc20))
* gate untrusted runs and add allowlisted file proposals ([#101](https://github.com/chamvi/chamvi/issues/101)) ([d49d07f](https://github.com/chamvi/chamvi/commit/d49d07f7b3555100857207abe778ce238b2cfe49))
* **github:** add persistent per-message comment slots ([#103](https://github.com/chamvi/chamvi/issues/103)) ([437191c](https://github.com/chamvi/chamvi/commit/437191c5e9af548c6a4bd0250f004b3209b2e48d))
* **skills:** add verified agent skills and startup installation ([#94](https://github.com/chamvi/chamvi/issues/94)) ([2c44e21](https://github.com/chamvi/chamvi/commit/2c44e21b57a9263e40ecc10d514079f90aa4ec1f))


### Bug Fixes

* **store-db,core:** bundle the 0.4 migrations and finish the release audit ([#105](https://github.com/chamvi/chamvi/issues/105)) ([d8c671a](https://github.com/chamvi/chamvi/commit/d8c671a0afc81d85b0bcf627206b0cf74f5cb580))


### Build System

* upgrade eslint config to 3.2.0 and require Node 24 ([00fa9b4](https://github.com/chamvi/chamvi/commit/00fa9b463c9e78ec783d3352c8ba8d16b7191758))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.3.1 to ^0.4.0
  * peerDependencies
    * @chamvi/core bumped from ^0.3.1 to ^0.4.0

## [0.3.1](https://github.com/chamvi/chamvi/compare/v0.3.0...v0.3.1) (2026-10-27)


### Features

* **core:** start runs of the same agent from a tool ([#64](https://github.com/chamvi/chamvi/issues/64)) ([083c385](https://github.com/chamvi/chamvi/commit/083c3852f1a0c494193e9e6ae36ca5739d1b275c))
* **github:** pull request tools and per-repository installations ([#66](https://github.com/chamvi/chamvi/issues/66)) ([1a87a3a](https://github.com/chamvi/chamvi/commit/1a87a3a68942aab59f7fe70d52b85b68756f6263))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.3.0 to ^0.3.1
  * peerDependencies
    * @chamvi/core bumped from ^0.3.0 to ^0.3.1

## [0.3.0](https://github.com/chamvi/chamvi/compare/v0.2.1...v0.3.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **coding:** stateful shell, background jobs, full output, ripgrep search, glob and multi_edit ([#49](https://github.com/chamvi/chamvi/issues/49))
* **sandbox:** find workspaces again across approvals, restarts and replicas ([#47](https://github.com/chamvi/chamvi/issues/47))

### Features

* **coding:** stateful shell, background jobs, full output, ripgrep search, glob and multi_edit ([#49](https://github.com/chamvi/chamvi/issues/49)) ([eef86ba](https://github.com/chamvi/chamvi/commit/eef86bafc35ee49651a5053cf64eb0ca70583853))
* **sandbox:** find workspaces again across approvals, restarts and replicas ([#47](https://github.com/chamvi/chamvi/issues/47)) ([0f9bcb3](https://github.com/chamvi/chamvi/commit/0f9bcb3c0055be8730050365afb1693a1a3cc512))
* **sandbox:** full git checkouts, pluggable credentials and git tools with a push policy ([#50](https://github.com/chamvi/chamvi/issues/50)) ([9f457bb](https://github.com/chamvi/chamvi/commit/9f457bb7ca64be5e90ebafbe840e6698f156d6f1))
* **tool-web:** add a web_fetch tool and GitHub release tools ([#51](https://github.com/chamvi/chamvi/issues/51)) ([a1bfd62](https://github.com/chamvi/chamvi/commit/a1bfd629a66a36637ca3f195c87bff2b0fd5b9f4))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.2.1 to ^0.3.0
  * peerDependencies
    * @chamvi/core bumped from ^0.2.1 to ^0.3.0

## [0.2.1](https://github.com/chamvi/chamvi/compare/v0.2.0...v0.2.1) (2026-10-25)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.2.0 to ^0.2.1
  * peerDependencies
    * @chamvi/core bumped from ^0.2.0 to ^0.2.1

## [0.2.0](https://github.com/chamvi/chamvi/compare/test-kit-v0.1.0...test-kit-v0.2.0) (2026-10-25)


### ⚠ BREAKING CHANGES

* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36))
* add agent folders and a live agent registry ([#34](https://github.com/chamvi/chamvi/issues/34))
* rename chamberu to chamvi ([#22](https://github.com/chamvi/chamvi/issues/22))
* rename RunEngine to Engine and read store, agents and clock from it ([#17](https://github.com/chamvi/chamvi/issues/17))
* **core:** stream model output, run attachments and structured output ([#11](https://github.com/chamvi/chamvi/issues/11))
* **http:** add http control api, webhooks, sse and mcp ([#10](https://github.com/chamvi/chamvi/issues/10))

### Features

* add @chamvi/app and @chamvi/cli ([#29](https://github.com/chamvi/chamvi/issues/29)) ([b6f618f](https://github.com/chamvi/chamvi/commit/b6f618f1fbefe76d7afa075d2e644bf1745c7c98))
* add agent folders and a live agent registry ([#34](https://github.com/chamvi/chamvi/issues/34)) ([fe96152](https://github.com/chamvi/chamvi/commit/fe9615226c3ca2af96457d9fa9ffa03dc46c20b2))
* add sandboxes, workspaces and coding tools ([#20](https://github.com/chamvi/chamvi/issues/20)) ([beb468e](https://github.com/chamvi/chamvi/commit/beb468e24ecbf968384445fa70e3f9d8dd26f3cf))
* add the openclaw and github notifiers ([#24](https://github.com/chamvi/chamvi/issues/24)) ([e6cbcb3](https://github.com/chamvi/chamvi/commit/e6cbcb36fd884b90337e3eba536b3691be0d6136))
* add the web ui ([#25](https://github.com/chamvi/chamvi/issues/25)) ([27d7642](https://github.com/chamvi/chamvi/commit/27d7642abb3faeefddde3153bc4a72f15c6afac6))
* **core:** stream model output, run attachments and structured output ([#11](https://github.com/chamvi/chamvi/issues/11)) ([1b22d15](https://github.com/chamvi/chamvi/commit/1b22d156995de529ee0e5055eeb2f7c7836bce39))
* **http:** add http control api, webhooks, sse and mcp ([#10](https://github.com/chamvi/chamvi/issues/10)) ([a53cc31](https://github.com/chamvi/chamvi/commit/a53cc31958594718e60d7593f3e10b4a233f284e))
* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38)) ([9ce771e](https://github.com/chamvi/chamvi/commit/9ce771ed4255e667d5592e70239ef6f44f937afe))
* rename chamberu to chamvi ([#22](https://github.com/chamvi/chamvi/issues/22)) ([8c049d9](https://github.com/chamvi/chamvi/commit/8c049d9861daa97640b2307f8481f06bab4cef9c))
* rename RunEngine to Engine and read store, agents and clock from it ([#17](https://github.com/chamvi/chamvi/issues/17)) ([bfdc437](https://github.com/chamvi/chamvi/commit/bfdc4370bc9655aa858518cc36fea2e759733232))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36)) ([78e8e7e](https://github.com/chamvi/chamvi/commit/78e8e7edc02e21da1dddec493887847eb4e61c7f))
* **scheduler:** add cron scheduler and runJob ([#9](https://github.com/chamvi/chamvi/issues/9)) ([ef235b4](https://github.com/chamvi/chamvi/commit/ef235b42403848efd6e9638055b82c1d3a0c7d55))
* **test-kit:** add ControllableClock and the store contract suite ([3f20c09](https://github.com/chamvi/chamvi/commit/3f20c09baa0d3ac9eaa88aa0007e02cdc62bb6ef))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @chamvi/core bumped from ^0.1.0 to ^0.2.0
  * peerDependencies
    * @chamvi/core bumped from ^0.1.0 to ^0.2.0
