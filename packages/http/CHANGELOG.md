# Changelog

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
