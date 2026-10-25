# Changelog

## [0.2.1](https://github.com/chamvi/chamvi/compare/v0.2.0...v0.2.1) (2026-10-25)


### Bug Fixes

* **app:** mark the default provider as v4 so string models are not converted twice ([#41](https://github.com/chamvi/chamvi/issues/41)) ([5780984](https://github.com/chamvi/chamvi/commit/5780984f9ec66790af1bf2c5b3a7b4adff077039))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @chamvi/channel-cron bumped from ^0.2.0 to ^0.2.1
    * @chamvi/core bumped from ^0.2.0 to ^0.2.1
    * @chamvi/http bumped from ^0.2.0 to ^0.2.1
    * @chamvi/store-typeorm bumped from ^0.2.0 to ^0.2.1
  * devDependencies
    * @chamvi/test-kit bumped from ^0.2.0 to ^0.2.1

## [0.2.0](https://github.com/chamvi/chamvi/compare/app-v0.1.0...app-v0.2.0) (2026-10-25)


### ⚠ BREAKING CHANGES

* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36))
* add agent folders and a live agent registry ([#34](https://github.com/chamvi/chamvi/issues/34))

### Features

* add @chamvi/app and @chamvi/cli ([#29](https://github.com/chamvi/chamvi/issues/29)) ([b6f618f](https://github.com/chamvi/chamvi/commit/b6f618f1fbefe76d7afa075d2e644bf1745c7c98))
* add agent folders and a live agent registry ([#34](https://github.com/chamvi/chamvi/issues/34)) ([fe96152](https://github.com/chamvi/chamvi/commit/fe9615226c3ca2af96457d9fa9ffa03dc46c20b2))
* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38)) ([9ce771e](https://github.com/chamvi/chamvi/commit/9ce771ed4255e667d5592e70239ef6f44f937afe))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36)) ([78e8e7e](https://github.com/chamvi/chamvi/commit/78e8e7edc02e21da1dddec493887847eb4e61c7f))


### Bug Fixes

* **deps:** bump the minorandpatch group across 1 directory with 4 updates ([#37](https://github.com/chamvi/chamvi/issues/37)) ([655adfc](https://github.com/chamvi/chamvi/commit/655adfcb7807d233a218fc62458f52e92dda0853))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @chamvi/channel-cron bumped from ^0.1.0 to ^0.2.0
    * @chamvi/core bumped from ^0.1.0 to ^0.2.0
    * @chamvi/http bumped from ^0.1.0 to ^0.2.0
    * @chamvi/store-typeorm bumped from ^0.1.0 to ^0.2.0
  * devDependencies
    * @chamvi/test-kit bumped from ^0.1.0 to ^0.2.0
