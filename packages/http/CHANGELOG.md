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

* harden trust gates, github, sandbox and coding before 0.4 ([#104](https://github.com/chamvi/chamvi/issues/104))
* Node.js 22 is no longer supported. All packages require Node.js >=24.3.0.
* add durable conversation memory and composable repositories ([#96](https://github.com/chamvi/chamvi/issues/96))

### Features

* add agent execution caps and channel HTTP limit policies ([#93](https://github.com/chamvi/chamvi/issues/93)) ([422a9e9](https://github.com/chamvi/chamvi/commit/422a9e9d80a48b0b7b057de51b078c598da7423c))
* add durable conversation memory and composable repositories ([#96](https://github.com/chamvi/chamvi/issues/96)) ([a183f1c](https://github.com/chamvi/chamvi/commit/a183f1c723b573603ee50533dd4ff25fc2efcc20))
* gate untrusted runs and add allowlisted file proposals ([#101](https://github.com/chamvi/chamvi/issues/101)) ([d49d07f](https://github.com/chamvi/chamvi/commit/d49d07f7b3555100857207abe778ce238b2cfe49))
* **skills:** add verified agent skills and startup installation ([#94](https://github.com/chamvi/chamvi/issues/94)) ([2c44e21](https://github.com/chamvi/chamvi/commit/2c44e21b57a9263e40ecc10d514079f90aa4ec1f))


### Bug Fixes

* **deps:** bump authup to 1.0.0-beta.72, vuecs, ilingo, vueuse 15, nx 24 and @types/node 26 ([0582ff2](https://github.com/chamvi/chamvi/commit/0582ff263dc48d7d339dbccf51d4fc7c68bb744f))
* harden trust gates, github, sandbox and coding before 0.4 ([#104](https://github.com/chamvi/chamvi/issues/104)) ([1fccd8a](https://github.com/chamvi/chamvi/commit/1fccd8afcc4b122e875c47b0bcf45d65d4b9cd9a))


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
* add agent folders and a live agent registry ([#34](https://github.com/chamvi/chamvi/issues/34))
* rename chamberu to chamvi ([#22](https://github.com/chamvi/chamvi/issues/22))
* rename RunEngine to Engine and read store, agents and clock from it ([#17](https://github.com/chamvi/chamvi/issues/17))
* **core:** stream model output, run attachments and structured output ([#11](https://github.com/chamvi/chamvi/issues/11))
* **http:** add http control api, webhooks, sse and mcp ([#10](https://github.com/chamvi/chamvi/issues/10))

### Features

* add agent folders and a live agent registry ([#34](https://github.com/chamvi/chamvi/issues/34)) ([fe96152](https://github.com/chamvi/chamvi/commit/fe9615226c3ca2af96457d9fa9ffa03dc46c20b2))
* add the github app connector ([#16](https://github.com/chamvi/chamvi/issues/16)) ([4de91e4](https://github.com/chamvi/chamvi/commit/4de91e45dd3ebb1cbedd576aec09e58b418c1115))
* add the web ui ([#25](https://github.com/chamvi/chamvi/issues/25)) ([27d7642](https://github.com/chamvi/chamvi/commit/27d7642abb3faeefddde3153bc4a72f15c6afac6))
* **core:** approvals with options ([#65](https://github.com/chamvi/chamvi/issues/65)) ([994da69](https://github.com/chamvi/chamvi/commit/994da698399a0b3c08e7aa9d3d4a55f82ff23169))
* **core:** stream model output, run attachments and structured output ([#11](https://github.com/chamvi/chamvi/issues/11)) ([1b22d15](https://github.com/chamvi/chamvi/commit/1b22d156995de529ee0e5055eeb2f7c7836bce39))
* **http:** add http control api, webhooks, sse and mcp ([#10](https://github.com/chamvi/chamvi/issues/10)) ([a53cc31](https://github.com/chamvi/chamvi/commit/a53cc31958594718e60d7593f3e10b4a233f284e))
* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38)) ([9ce771e](https://github.com/chamvi/chamvi/commit/9ce771ed4255e667d5592e70239ef6f44f937afe))
* record the run invoker and restrict tools per invoker ([#12](https://github.com/chamvi/chamvi/issues/12)) ([a0326e7](https://github.com/chamvi/chamvi/commit/a0326e7111880882cff8a9772b99773f874cc1fb))
* rename chamberu to chamvi ([#22](https://github.com/chamvi/chamvi/issues/22)) ([8c049d9](https://github.com/chamvi/chamvi/commit/8c049d9861daa97640b2307f8481f06bab4cef9c))
* rename RunEngine to Engine and read store, agents and clock from it ([#17](https://github.com/chamvi/chamvi/issues/17)) ([bfdc437](https://github.com/chamvi/chamvi/commit/bfdc4370bc9655aa858518cc36fea2e759733232))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36)) ([78e8e7e](https://github.com/chamvi/chamvi/commit/78e8e7edc02e21da1dddec493887847eb4e61c7f))


### Bug Fixes

* **deps:** bump @modelcontextprotocol/server from 2.3.1 to 2.4.0 in the minorandpatch group ([#62](https://github.com/chamvi/chamvi/issues/62)) ([2c2d9db](https://github.com/chamvi/chamvi/commit/2c2d9db795fb23374280150151957ab691a76531))
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

## [0.2.0](https://github.com/chamvi/chamvi/compare/http-v0.1.0...http-v0.2.0) (2026-10-25)


### ⚠ BREAKING CHANGES

* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36))
* add agent folders and a live agent registry ([#34](https://github.com/chamvi/chamvi/issues/34))
* rename chamberu to chamvi ([#22](https://github.com/chamvi/chamvi/issues/22))
* rename RunEngine to Engine and read store, agents and clock from it ([#17](https://github.com/chamvi/chamvi/issues/17))
* **core:** stream model output, run attachments and structured output ([#11](https://github.com/chamvi/chamvi/issues/11))
* **http:** add http control api, webhooks, sse and mcp ([#10](https://github.com/chamvi/chamvi/issues/10))

### Features

* add agent folders and a live agent registry ([#34](https://github.com/chamvi/chamvi/issues/34)) ([fe96152](https://github.com/chamvi/chamvi/commit/fe9615226c3ca2af96457d9fa9ffa03dc46c20b2))
* add the github app connector ([#16](https://github.com/chamvi/chamvi/issues/16)) ([4de91e4](https://github.com/chamvi/chamvi/commit/4de91e45dd3ebb1cbedd576aec09e58b418c1115))
* add the web ui ([#25](https://github.com/chamvi/chamvi/issues/25)) ([27d7642](https://github.com/chamvi/chamvi/commit/27d7642abb3faeefddde3153bc4a72f15c6afac6))
* **core:** stream model output, run attachments and structured output ([#11](https://github.com/chamvi/chamvi/issues/11)) ([1b22d15](https://github.com/chamvi/chamvi/commit/1b22d156995de529ee0e5055eeb2f7c7836bce39))
* **http:** add http control api, webhooks, sse and mcp ([#10](https://github.com/chamvi/chamvi/issues/10)) ([a53cc31](https://github.com/chamvi/chamvi/commit/a53cc31958594718e60d7593f3e10b4a233f284e))
* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38)) ([9ce771e](https://github.com/chamvi/chamvi/commit/9ce771ed4255e667d5592e70239ef6f44f937afe))
* record the run invoker and restrict tools per invoker ([#12](https://github.com/chamvi/chamvi/issues/12)) ([a0326e7](https://github.com/chamvi/chamvi/commit/a0326e7111880882cff8a9772b99773f874cc1fb))
* rename chamberu to chamvi ([#22](https://github.com/chamvi/chamvi/issues/22)) ([8c049d9](https://github.com/chamvi/chamvi/commit/8c049d9861daa97640b2307f8481f06bab4cef9c))
* rename RunEngine to Engine and read store, agents and clock from it ([#17](https://github.com/chamvi/chamvi/issues/17)) ([bfdc437](https://github.com/chamvi/chamvi/commit/bfdc4370bc9655aa858518cc36fea2e759733232))
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
