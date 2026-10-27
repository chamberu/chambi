# Changelog

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
