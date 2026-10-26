# Changelog

## [0.3.0](https://github.com/chamvi/chamvi/compare/v0.2.1...v0.3.0) (2026-10-26)


### ⚠ BREAKING CHANGES

* **app:** replace doctor with start --check and make agent reloads visible ([#61](https://github.com/chamvi/chamvi/issues/61))
* **app:** resolve models through declared providers and add chamvi doctor ([#58](https://github.com/chamvi/chamvi/issues/58))
* **coding:** stateful shell, background jobs, full output, ripgrep search, glob and multi_edit ([#49](https://github.com/chamvi/chamvi/issues/49))

### Features

* **app:** replace doctor with start --check and make agent reloads visible ([#61](https://github.com/chamvi/chamvi/issues/61)) ([6c971ec](https://github.com/chamvi/chamvi/commit/6c971ec381b01895dc32f34902c1be52d4090f33))
* **app:** resolve models through declared providers and add chamvi doctor ([#58](https://github.com/chamvi/chamvi/issues/58)) ([04309b9](https://github.com/chamvi/chamvi/commit/04309b93b217c270639d0951eb1d5f00009d4ce0))
* **coding:** stateful shell, background jobs, full output, ripgrep search, glob and multi_edit ([#49](https://github.com/chamvi/chamvi/issues/49)) ([eef86ba](https://github.com/chamvi/chamvi/commit/eef86bafc35ee49651a5053cf64eb0ca70583853))
* **core:** add an engine model resolver and an optional agent model ([#57](https://github.com/chamvi/chamvi/issues/57)) ([d279e52](https://github.com/chamvi/chamvi/commit/d279e52834bc2f6b83edfac2d51b7cc84ea8bb29))

## [0.2.1](https://github.com/chamvi/chamvi/compare/v0.2.0...v0.2.1) (2026-10-25)

## [0.2.0](https://github.com/chamvi/chamvi/compare/core-v0.1.0...core-v0.2.0) (2026-10-25)


### ⚠ BREAKING CHANGES

* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36))
* add agent folders and a live agent registry ([#34](https://github.com/chamvi/chamvi/issues/34))
* rename chamberu to chamvi ([#22](https://github.com/chamvi/chamvi/issues/22))
* rename RunEngine to Engine and read store, agents and clock from it ([#17](https://github.com/chamvi/chamvi/issues/17))
* **core:** `effectKey(input, ctx)` and `alreadyApplied(key, input, ctx)` receive the `ToolContext { run, state, artifacts }` instead of the `RunContext`: `ctx.runId` becomes `ctx.run.runId` (likewise `agent`, `trigger`, `signal`). `wrapToolsForRun(tools, ctx, store, allow?)` takes a `ToolContext`, and `createStateTools(schema)` drops its `state` parameter (the tools read `context.state`). `defineEffectTool` and `defineTool` require `execute`.
* **core:** stream model output, run attachments and structured output ([#11](https://github.com/chamvi/chamvi/issues/11))
* **http:** add http control api, webhooks, sse and mcp ([#10](https://github.com/chamvi/chamvi/issues/10))
* **core:** the @chamberu/core/testing entry is removed; ControllableClock and describeStoreContract move to @chamberu/test-kit. Store, Clock, Notifier and AgentState (and the Store parts) are renamed to IStore, IClock, INotifier and IAgentState. ValidationError carries the validup issues in `issues` instead of `validationIssues`.

### Features

* add @chamvi/app and @chamvi/cli ([#29](https://github.com/chamvi/chamvi/issues/29)) ([b6f618f](https://github.com/chamvi/chamvi/commit/b6f618f1fbefe76d7afa075d2e644bf1745c7c98))
* add agent folders and a live agent registry ([#34](https://github.com/chamvi/chamvi/issues/34)) ([fe96152](https://github.com/chamvi/chamvi/commit/fe9615226c3ca2af96457d9fa9ffa03dc46c20b2))
* add sandboxes, workspaces and coding tools ([#20](https://github.com/chamvi/chamvi/issues/20)) ([beb468e](https://github.com/chamvi/chamvi/commit/beb468e24ecbf968384445fa70e3f9d8dd26f3cf))
* add the github app connector ([#16](https://github.com/chamvi/chamvi/issues/16)) ([4de91e4](https://github.com/chamvi/chamvi/commit/4de91e45dd3ebb1cbedd576aec09e58b418c1115))
* add the openclaw and github notifiers ([#24](https://github.com/chamvi/chamvi/issues/24)) ([e6cbcb3](https://github.com/chamvi/chamvi/commit/e6cbcb36fd884b90337e3eba536b3691be0d6136))
* add the web ui ([#25](https://github.com/chamvi/chamvi/issues/25)) ([27d7642](https://github.com/chamvi/chamvi/commit/27d7642abb3faeefddde3153bc4a72f15c6afac6))
* **core:** add agent and trigger definitions ([bb824d4](https://github.com/chamvi/chamvi/commit/bb824d463c5987ba0d934f4af105733762ec2874))
* **core:** add agent state and state tools ([f49c6d5](https://github.com/chamvi/chamvi/commit/f49c6d5edda931c4c2d97f6dfd269705e9df9358))
* **core:** add approval pauses with signed resume tokens ([10db0bd](https://github.com/chamvi/chamvi/commit/10db0bdc9978424924738f9512d17b3c8f7c674c))
* **core:** add effect tools with reconciliation ([4a21332](https://github.com/chamvi/chamvi/commit/4a21332d31285ff4516ad094ae41687ae18fccf7))
* **core:** add recovery and graceful drain ([3ca1f99](https://github.com/chamvi/chamvi/commit/3ca1f99eeca9cdc8c9dfb85e7e95fdc79e9342d5))
* **core:** add run dispatch with idempotency and concurrency ([ca77998](https://github.com/chamvi/chamvi/commit/ca77998be128e11f72711779ec02097e1640988e))
* **core:** add store contract and memory store ([ad1e403](https://github.com/chamvi/chamvi/commit/ad1e403d33d9e1a6fc963a7d8ceafe22c210ba88))
* **core:** execute runs with step checkpoints and budgets ([46d62aa](https://github.com/chamvi/chamvi/commit/46d62aa52ec2d1fc1f06912ce472635f67e323d9))
* **core:** expose public api ([40c3292](https://github.com/chamvi/chamvi/commit/40c329232d5dbb4d747f85822558084fdf2eff8a))
* **core:** pass the run context to tool execute ([#13](https://github.com/chamvi/chamvi/issues/13)) ([cee3017](https://github.com/chamvi/chamvi/commit/cee30172c29852c7fed5b99810d522a4f10d1d1f))
* **core:** stream model output, run attachments and structured output ([#11](https://github.com/chamvi/chamvi/issues/11)) ([1b22d15](https://github.com/chamvi/chamvi/commit/1b22d156995de529ee0e5055eeb2f7c7836bce39))
* **http:** add http control api, webhooks, sse and mcp ([#10](https://github.com/chamvi/chamvi/issues/10)) ([a53cc31](https://github.com/chamvi/chamvi/commit/a53cc31958594718e60d7593f3e10b4a233f284e))
* provider/model strings, entry-less apps and approvals without resume tokens ([#38](https://github.com/chamvi/chamvi/issues/38)) ([9ce771e](https://github.com/chamvi/chamvi/commit/9ce771ed4255e667d5592e70239ef6f44f937afe))
* record the run invoker and restrict tools per invoker ([#12](https://github.com/chamvi/chamvi/issues/12)) ([a0326e7](https://github.com/chamvi/chamvi/commit/a0326e7111880882cff8a9772b99773f874cc1fb))
* rename chamberu to chamvi ([#22](https://github.com/chamvi/chamvi/issues/22)) ([8c049d9](https://github.com/chamvi/chamvi/commit/8c049d9861daa97640b2307f8481f06bab4cef9c))
* rename RunEngine to Engine and read store, agents and clock from it ([#17](https://github.com/chamvi/chamvi/issues/17)) ([bfdc437](https://github.com/chamvi/chamvi/commit/bfdc4370bc9655aa858518cc36fea2e759733232))
* replace triggers and notifiers with channels ([#36](https://github.com/chamvi/chamvi/issues/36)) ([78e8e7e](https://github.com/chamvi/chamvi/commit/78e8e7edc02e21da1dddec493887847eb4e61c7f))
* **scheduler:** add cron scheduler and runJob ([#9](https://github.com/chamvi/chamvi/issues/9)) ([ef235b4](https://github.com/chamvi/chamvi/commit/ef235b42403848efd6e9638055b82c1d3a0c7d55))


### Bug Fixes

* **core:** accept payload-typed triggers in agent definitions ([5944161](https://github.com/chamvi/chamvi/commit/5944161ab978cdaf7575eb842f2020ffb7c6ea7d))
* **core:** cancel runs executing on other replicas and runs caught mid-pause ([de01cd8](https://github.com/chamvi/chamvi/commit/de01cd80e19ce2c509f0ddb95d6cd6400775faf6))
* **core:** copy values in memory store and extend store contract ([9d10208](https://github.com/chamvi/chamvi/commit/9d102082a142c48f7d24a603c3c5870ab083bdcc))
* **core:** harden effect hashing, recording failures and key errors ([bc92a8c](https://github.com/chamvi/chamvi/commit/bc92a8c52dae10064a12d7006658df22425148f8))
* **core:** heal an idempotency key whose run was never created ([bb2e715](https://github.com/chamvi/chamvi/commit/bb2e715577f09ab33a5caa4567dfc648ab8132e0))
* **core:** keep interrupted runs blocking their concurrency key ([54b5e29](https://github.com/chamvi/chamvi/commit/54b5e299dfbd233a6aa35b59f9f016bde41ab1ed))
* **core:** keep resume tokens valid across crashes and honour approvals on the last step ([f76f199](https://github.com/chamvi/chamvi/commit/f76f19903c22a168aa033ca4e941948c9757c1d3))
* **core:** keep run transitions safe when lock release fails and poll restarts ([f6309b7](https://github.com/chamvi/chamvi/commit/f6309b74f00894700838e2070249b28a7da2716e))
* **core:** make keyed dispatch atomic across replicas and harden the queue ([20bccdd](https://github.com/chamvi/chamvi/commit/20bccdd3733feced8f13dfe7e1068a52a07a0361))
* **core:** persist a completed step when a drain aborts during its writes ([095fe1d](https://github.com/chamvi/chamvi/commit/095fe1d5c0eaf7707e67b0076f7c1daeb437a3fc))
* **core:** reject duplicate agent names and an empty resume secret ([a8142b0](https://github.com/chamvi/chamvi/commit/a8142b0846284e63e3b1f1d5abf9bd38a54a2454))
* **core:** retry undelivered approval notifications on every poll ([02509cc](https://github.com/chamvi/chamvi/commit/02509cc411ea6b795ecbec861c52ba14ff591015))
* **core:** stop abandoned executions from writing and feed tool errors back to the model ([e6e56ab](https://github.com/chamvi/chamvi/commit/e6e56ab14bc8a4d0c8169af5f3ad4b6a69b2724e))
* **deps:** bump the minorandpatch group across 1 directory with 4 updates ([#37](https://github.com/chamvi/chamvi/issues/37)) ([655adfc](https://github.com/chamvi/chamvi/commit/655adfcb7807d233a218fc62458f52e92dda0853))


### Code Refactoring

* **core:** organize modules as folders and prefix contract interfaces ([e23e155](https://github.com/chamvi/chamvi/commit/e23e1556b284d34d59c49a542ea9f6f1170b1434))
