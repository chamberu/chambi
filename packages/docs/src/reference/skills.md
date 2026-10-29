# @chamvi/skills

Optional filesystem verification and startup or setup/build preparation for explicitly selected Git skill sources. Requires Git and Node >=22.20; the runtime packages retain their existing Node floor.

```bash
npm install @chamvi/skills @chamvi/core
```

## Runtime contracts

The passive contracts are exported by `@chamvi/core` (also through app):

<<< ../../../core/src/skill/types.ts{ts}

## gitSkills

```ts
import { gitSkills } from '@chamvi/skills';

function gitSkills(options: GitSkillsOptions): ISkillSource;
```

<<< ../../../skills/src/source/types.ts{ts}

This pure factory copies source configuration and reviewed headers. Pass its result to app/engine `skills` defaults or an agent's extra `skills`. Engine preparation verifies exactly the declared identities before publishing immutable results. No `/module` entry or app module is needed. See [Approved skills](/guide/skills) for startup ordering, cancellation, deployment and replay limits.

## Local snapshots and manual catalogs

```ts
type ApprovedSkill = {
    name: string;
    version: string;
    directory: string; // absolute runtime path
    hash: string; // independently reviewed lowercase SHA-256 digest
};

function hashSkillBundle(directory: string): string;
function loadSkillBundle(approved: ApprovedSkill): Skill;
function loadSkillBundles(approved: readonly ApprovedSkill[]): SkillCatalog;
```

The singular loader verifies and returns a ready snapshot for first-class `skills` arrays. The plural loader returns the supported manual catalog (`skills`, metadata-only `instructions`, `tools`); callers compose it explicitly and guard `load_skill` collisions. Hashing is a separate review aid and never grants approval. All helpers read only when explicitly called; imports do no I/O. Bundle bounds and digest framing are in the [guide](/guide/skills#bundle-format-and-bounds).

## prepareSkills

```ts
function prepareSkills(options: PrepareSkillsOptions): Promise<readonly PreparedSkill[]>;
```

<<< ../../../skills/src/prepare/types.ts{ts}

`source` is an operator-configured local Git repository, Git URL or repository shorthand supported by the source parser. `revision` must be a full 40-character commit SHA; the cloned HEAD must match it. Embedded source refs/skill filters are refused. Local repositories are cloned at that commit, excluding working-tree edits. Names use `^[a-z][a-z0-9-]{0,63}$`, must be unique, and must each resolve to exactly one discovered skill. The complete committed source must be symlink-free, including paths outside selected bundles. After checking HEAD, preparation inspects the committed Git tree and rejects any source link before discovery or copying; failed tree inspection also rejects preparation. Return order follows `names`; paths are absolute.

`directory` is a dedicated managed corpus, created if missing. Preparation refuses symlinks and nonempty unowned directories. A `.chamvi-skills` ownership marker lives at its root, outside the individual bundles. Successful replacement removes the previous corpus, including previously selected names. Do not put application files there.

Selected copies and optional `verify` callbacks run in sibling staging before promotion. A verifier must throw to reject and return no value on success; any returned value is refused, including a boolean comparison. A missing/ambiguous selection or failed verifier leaves old output intact. Promotion failure restores the previous directory; a filesystem failure that also prevents restoration preserves the backup in the sibling staging directory. A sibling `.<directory-name>.chamvi-skills-lock` guard refuses concurrent preparation of the same target. After a process crash, remove that guard only after confirming no preparation is running. Cleanup normally removes checkout, staging and guard.

Failures throw `InvalidAgentDefinitionError` without raw source URLs, credentials, file bodies or verifier errors. Importing the package performs no preparation. The package never changes the process cwd, invokes the skills CLI or executes source scripts. It copies source assets using the SDK's installer rules; independently reviewed bundle hashes detect omissions or changed bytes. Git LFS content remains pointer files. Preparation alone grants no runtime approval or tools.

## Verified runtime loading

Review and record content hashes independently, then verify staged copies before replacement. This example's imports and public types remain the same when Chamvi replaces its internal source backend:

<<< ../../../skills/test/fixtures/readme-example.ts{ts}

The app owns source/commit configuration, role profiles and reviewed pins. Combine selected names and pins before constructing one manual catalog. Append `catalog.instructions` to role instructions and compose `catalog.tools` explicitly, checking for a `load_skill` collision. This manual workflow may run in a setup/build task with already deployed assets. For runtime installation, prefer `gitSkills()` and let the engine own preparation and cancellation. See [Approved local skills](/guide/skills) for runtime validation, permissions and deployment.

Chamvi owns the temporary commit-pinned backend. Consumers do not import its SDK, fork or types. Backend replacement criteria are tracked in [issue #97](https://github.com/chamvi/chamvi/issues/97).

`signal` is optional for `prepareSkills`. Cancellation is checked around clone/copy/verification phases and before promotion. Native Git metadata commands receive it; SDK cloning is awaited to actual settlement before cleanup. Promotion/rollback is completed once entered. Stop may wait for cloning; no bounded-fast-shutdown guarantee is made. Git providers require runtime Git (absent from the base Node 24 image), writable corpus/tmp space, source credentials/network and sufficient startup probe time. Prebuilt local snapshots need only the deployed readable bundle files.
