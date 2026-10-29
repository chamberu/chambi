# @chamvi/skills

Optional setup/build preparation for explicitly selected Git skill sources. Requires Git and Node >=22.20; the runtime packages retain their existing Node floor.

```bash
npm install @chamvi/skills @chamvi/core
```

## prepareSkills

```ts
function prepareSkills(options: PrepareSkillsOptions): Promise<readonly PreparedSkill[]>;
```

<<< ../../../skills/src/prepare/types.ts{ts}

`source` is an operator-configured local Git repository, Git URL or repository shorthand supported by the source parser. `revision` must be a full 40-character commit SHA; the cloned HEAD must match it. Embedded source refs/skill filters are refused. Local repositories are cloned at that commit, excluding working-tree edits. Names use `^[a-z][a-z0-9-]{0,63}$`, must be unique, and must each resolve to exactly one discovered skill. Return order follows `names`; paths are absolute.

`directory` is a dedicated managed corpus, created if missing. Preparation refuses symlinks and nonempty unowned directories. A `.chamvi-skills` ownership marker lives at its root, outside the individual bundles. Successful replacement removes the previous corpus, including previously selected names. Do not put application files there.

Selected copies and optional `verify` callbacks run in sibling staging before promotion. A verifier must throw to reject and return no value on success; any returned value is refused, including a boolean comparison. A missing/ambiguous selection or failed verifier leaves old output intact. Promotion failure restores the previous directory; a filesystem failure that also prevents restoration preserves the backup in the sibling staging directory. A sibling `.<directory-name>.chamvi-skills-lock` guard refuses concurrent preparation of the same target. After a process crash, remove that guard only after confirming no preparation is running. Cleanup normally removes checkout, staging and guard.

Failures throw `InvalidAgentDefinitionError` without raw source URLs, credentials, file bodies or verifier errors. Importing the package performs no preparation. The package never changes the process cwd, invokes the skills CLI or executes source scripts. It copies source assets using the SDK's installer rules; independently reviewed bundle hashes detect omissions or changed bytes. Git LFS content remains pointer files. Preparation alone grants no runtime approval or tools.

## Verified runtime loading

Review and record content hashes independently, then verify staged copies before replacement. This example's imports and public types remain the same when Chamvi replaces its internal source backend:

<<< ../../../skills/test/fixtures/readme-example.ts{ts}

The app owns source/commit configuration, role profiles and reviewed pins. Combine selected names and pins before constructing one catalog. Append `catalog.instructions` to role instructions and compose `catalog.tools` explicitly, checking for a `load_skill` collision. Run preparation in a setup/build task; keep runtime startup on already deployed assets. See [Approved local skills](/guide/skills) for runtime validation, permissions and deployment.

Chamvi owns the temporary commit-pinned backend. Consumers do not import its SDK, fork or types. Backend replacement criteria are tracked in [issue #97](https://github.com/chamvi/chamvi/issues/97).
