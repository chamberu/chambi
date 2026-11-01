# Changelog

## [0.4.0](https://github.com/chamvi/chamvi/compare/v0.3.1...v0.4.0) (2026-11-01)


### ⚠ BREAKING CHANGES

* **store-db,core:** migrations from the pre-release window are replaced by `ConversationsRunTaint1792713600000`, so recreate or reconcile development databases. Writes for unknown runs reject with `RunNotFoundError`. Upgrading from 0.3 needs downtime, as described in the upgrade guide.
* harden trust gates, github, sandbox and coding before 0.4 ([#104](https://github.com/chamvi/chamvi/issues/104))
* Node.js 22 is no longer supported. All packages require Node.js >=24.3.0.
* add durable conversation memory and composable repositories ([#96](https://github.com/chamvi/chamvi/issues/96))
* **sandbox:** use bash-first workspace credentials ([#87](https://github.com/chamvi/chamvi/issues/87))

### Features

* add agent execution caps and channel HTTP limit policies ([#93](https://github.com/chamvi/chamvi/issues/93)) ([422a9e9](https://github.com/chamvi/chamvi/commit/422a9e9d80a48b0b7b057de51b078c598da7423c))
* add durable conversation memory and composable repositories ([#96](https://github.com/chamvi/chamvi/issues/96)) ([a183f1c](https://github.com/chamvi/chamvi/commit/a183f1c723b573603ee50533dd4ff25fc2efcc20))
* gate untrusted runs and add allowlisted file proposals ([#101](https://github.com/chamvi/chamvi/issues/101)) ([d49d07f](https://github.com/chamvi/chamvi/commit/d49d07f7b3555100857207abe778ce238b2cfe49))
* **github:** add persistent per-message comment slots ([#103](https://github.com/chamvi/chamvi/issues/103)) ([437191c](https://github.com/chamvi/chamvi/commit/437191c5e9af548c6a4bd0250f004b3209b2e48d))
* load scoped repository instructions ([#95](https://github.com/chamvi/chamvi/issues/95)) ([5d93bbb](https://github.com/chamvi/chamvi/commit/5d93bbba451f0af9af9809540cfacf8496fd4108))
* **skills:** add verified agent skills and startup installation ([#94](https://github.com/chamvi/chamvi/issues/94)) ([2c44e21](https://github.com/chamvi/chamvi/commit/2c44e21b57a9263e40ecc10d514079f90aa4ec1f))


### Bug Fixes

* **deps:** bump authup to 1.0.0-beta.72, vuecs, ilingo, vueuse 15, nx 24 and @types/node 26 ([0582ff2](https://github.com/chamvi/chamvi/commit/0582ff263dc48d7d339dbccf51d4fc7c68bb744f))
* harden trust gates, github, sandbox and coding before 0.4 ([#104](https://github.com/chamvi/chamvi/issues/104)) ([1fccd8a](https://github.com/chamvi/chamvi/commit/1fccd8afcc4b122e875c47b0bcf45d65d4b9cd9a))
* **release:** align linked workspace release candidates ([#89](https://github.com/chamvi/chamvi/issues/89)) ([68484af](https://github.com/chamvi/chamvi/commit/68484af53538ad465a16651b74e2c8ca0bb5b6ce)), closes [#74](https://github.com/chamvi/chamvi/issues/74) [#75](https://github.com/chamvi/chamvi/issues/75)
* **sandbox:** use bash-first workspace credentials ([#87](https://github.com/chamvi/chamvi/issues/87)) ([1731c74](https://github.com/chamvi/chamvi/commit/1731c74ebe8f876bb8c3749df8643e588a1111cc))
* **store-db,core:** bundle the 0.4 migrations and finish the release audit ([#105](https://github.com/chamvi/chamvi/issues/105)) ([d8c671a](https://github.com/chamvi/chamvi/commit/d8c671a0afc81d85b0bcf627206b0cf74f5cb580))


### Build System

* upgrade eslint config to 3.2.0 and require Node 24 ([00fa9b4](https://github.com/chamvi/chamvi/commit/00fa9b463c9e78ec783d3352c8ba8d16b7191758))

## [0.3.1](https://github.com/chamvi/chamvi/compare/v0.3.0...v0.3.1) (2026-10-27)


### Features

* **core:** approvals with options ([#65](https://github.com/chamvi/chamvi/issues/65)) ([994da69](https://github.com/chamvi/chamvi/commit/994da698399a0b3c08e7aa9d3d4a55f82ff23169))
* **core:** start runs of the same agent from a tool ([#64](https://github.com/chamvi/chamvi/issues/64)) ([083c385](https://github.com/chamvi/chamvi/commit/083c3852f1a0c494193e9e6ae36ca5739d1b275c))
* **github:** pull request tools and per-repository installations ([#66](https://github.com/chamvi/chamvi/issues/66)) ([1a87a3a](https://github.com/chamvi/chamvi/commit/1a87a3a68942aab59f7fe70d52b85b68756f6263))


### Bug Fixes

* **deps:** bump @modelcontextprotocol/server from 2.3.1 to 2.4.0 in the minorandpatch group ([#62](https://github.com/chamvi/chamvi/issues/62)) ([2c2d9db](https://github.com/chamvi/chamvi/commit/2c2d9db795fb23374280150151957ab691a76531))
* ensure consistent version for release ([#67](https://github.com/chamvi/chamvi/issues/67)) ([c08d0fb](https://github.com/chamvi/chamvi/commit/c08d0fbf89c5083f750ed5c966513aad79bbabe6))

## [0.3.0](https://github.com/chamvi/chamvi/compare/v0.2.1...v0.3.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **app:** replace doctor with start --check and make agent reloads visible ([#61](https://github.com/chamvi/chamvi/issues/61))
* **sandbox:** safe workspace defaults and credential redaction fixes ([#60](https://github.com/chamvi/chamvi/issues/60))
* **app:** resolve models through declared providers and add chamvi doctor ([#58](https://github.com/chamvi/chamvi/issues/58))
* **coding:** stateful shell, background jobs, full output, ripgrep search, glob and multi_edit ([#49](https://github.com/chamvi/chamvi/issues/49))
* **sandbox:** root workspaces, any image, a shared package cache and sandbox-dev ([#48](https://github.com/chamvi/chamvi/issues/48))
* **sandbox:** find workspaces again across approvals, restarts and replicas ([#47](https://github.com/chamvi/chamvi/issues/47))

### Features

* **app:** replace doctor with start --check and make agent reloads visible ([#61](https://github.com/chamvi/chamvi/issues/61)) ([6c971ec](https://github.com/chamvi/chamvi/commit/6c971ec381b01895dc32f34902c1be52d4090f33))
* **app:** resolve models through declared providers and add chamvi doctor ([#58](https://github.com/chamvi/chamvi/issues/58)) ([04309b9](https://github.com/chamvi/chamvi/commit/04309b93b217c270639d0951eb1d5f00009d4ce0))
* **coding:** stateful shell, background jobs, full output, ripgrep search, glob and multi_edit ([#49](https://github.com/chamvi/chamvi/issues/49)) ([eef86ba](https://github.com/chamvi/chamvi/commit/eef86bafc35ee49651a5053cf64eb0ca70583853))
* **core:** add an engine model resolver and an optional agent model ([#57](https://github.com/chamvi/chamvi/issues/57)) ([d279e52](https://github.com/chamvi/chamvi/commit/d279e52834bc2f6b83edfac2d51b7cc84ea8bb29))
* **sandbox:** find workspaces again across approvals, restarts and replicas ([#47](https://github.com/chamvi/chamvi/issues/47)) ([0f9bcb3](https://github.com/chamvi/chamvi/commit/0f9bcb3c0055be8730050365afb1693a1a3cc512))
* **sandbox:** full git checkouts, pluggable credentials and git tools with a push policy ([#50](https://github.com/chamvi/chamvi/issues/50)) ([9f457bb](https://github.com/chamvi/chamvi/commit/9f457bb7ca64be5e90ebafbe840e6698f156d6f1))
* **sandbox:** root workspaces, any image, a shared package cache and sandbox-dev ([#48](https://github.com/chamvi/chamvi/issues/48)) ([b7131c0](https://github.com/chamvi/chamvi/commit/b7131c0e58fe8c5e2e88bd34248f6208517d9159))
* **tool-web:** add a web_fetch tool and GitHub release tools ([#51](https://github.com/chamvi/chamvi/issues/51)) ([a1bfd62](https://github.com/chamvi/chamvi/commit/a1bfd629a66a36637ca3f195c87bff2b0fd5b9f4))


### Bug Fixes

* **sandbox:** safe workspace defaults and credential redaction fixes ([#60](https://github.com/chamvi/chamvi/issues/60)) ([ce751fc](https://github.com/chamvi/chamvi/commit/ce751fc3bafb639d3a8932f3f6e3ca57c2d60417))

## [0.2.1](https://github.com/chamvi/chamvi/compare/v0.2.0...v0.2.1) (2026-10-25)


### Bug Fixes

* **app:** mark the default provider as v4 so string models are not converted twice ([#41](https://github.com/chamvi/chamvi/issues/41)) ([5780984](https://github.com/chamvi/chamvi/commit/5780984f9ec66790af1bf2c5b3a7b4adff077039))
