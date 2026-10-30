# @chamvi/skills

Verify passive skill bundles and prepare explicitly selected, commit-pinned sources for Chamvi agents. This optional package requires Node >=24.3.0; Git is needed for source preparation.

```bash
npm install @chamvi/skills @chamvi/core
```

Use `gitSkills()` from the main entry for first-class engine/app defaults or agent extras:

```ts
import { Engine, createMemoryStore, defineAgent } from '@chamvi/core';
import { gitSkills } from '@chamvi/skills';

const common = gitSkills({
    source: 'https://github.com/tada5hi/skills.git',
    revision: '0123456789abcdef0123456789abcdef01234567', // reviewed commit
    directory: '/tmp/chamvi-skills/common',
    approved: [{
        name: 'ponytail',
        version: '1.0.0',
        hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    }],
});
const engine = new Engine({
    store: createMemoryStore(),
    model: yourLanguageModel,
    skills: [common],
    agents: [defineAgent({ name: 'reviewer', instructions: 'Review the requested scope.' })],
});
await engine.start();
```

Replace the illustrative commit/digest with independently reviewed pins and `yourLanguageModel` with an AI SDK model. `gitSkills` copies configuration without I/O. Startup verifies required sources before recovery, channels and model work. The engine automatically appends metadata and supplies scoped `load_skill`; an agent's `skills` adds extras to defaults. `loadSkillBundle(descriptor)` returns a ready verified snapshot for the same arrays. Skill data and behavior belong to this package; no app module or `/module` entry is needed. Among Chamvi packages, the main entry depends only on core, with no app dependency. Core/app remain usable without skills installed.

Startup installation requires this package and Git in the runtime image, writable managed corpus/tmp paths, source network/credentials and startup probe time. The base Node 24 image does not include Git. Check/migrate do not invoke skill providers; check defers remote verification. Stop joins cleanup and may wait for a noncancelable clone. Prebuilt local snapshots avoid runtime Git/network requirements. Global pin upgrades do not change folder hashes: saved load results keep original bytes, while pending/future loads use current snapshots. Finish or cancel unsettled runs before global upgrades if mixed-version disclosure is unacceptable.

`Skill`, `SkillIdentity`, `SkillMetadata`, `ISkillSource`, `SkillCatalog`, `LoadedSkill` and `createSkillCatalog()` are exported from `@chamvi/skills`. Core exports only the generic `SkillInput` and preparation/contribution contracts. For caller-provided values, use `defineSkill(rawSkill)` or `defineSkillSource(rawSource)` before placing them in a `skills` array. These adapters validate and copy contents/declarations and attach the runtime; they do not fetch or independently hash-verify caller-provided text. Custom loaders own retrieval and verification against their reviewed pins. `gitSkills()` and `loadSkillBundle()` already return adapted values.

First-class runtime metadata is a separate frozen system-message block appended after the agent's configured instructions, including structured system/user/assistant arrays. It contains descriptions and identities, with bodies and references disclosed only through `load_skill`. The standalone `SkillCatalog.instructions` stays a string, so existing manual string composition remains compatible. For a structured manual configuration, append `{ role: 'system', content: catalog.instructions }` to the array and merge `catalog.tools` explicitly.

The manual catalog workflow remains supported:

Call `prepareSkills({ source, revision, names, directory, verify? })` in an explicit setup/build task. The source is a local Git repository, Git URL or repository shorthand; revision is a full 40-character commit. The result is an ordered readonly list of `{ name, description, path }`, with absolute paths. Source configuration, role choices and independently reviewed content pins belong to your application.

```ts
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { hashSkillBundle, loadSkillBundles, prepareSkills } from '@chamvi/skills';
import type { PrepareSkillsOptions, PreparedSkill } from '@chamvi/skills';

// Call in an explicit setup/build task, with separately reviewed pins from app configuration.
export async function prepareCatalog(options: Omit<PrepareSkillsOptions, 'verify'>, pins: Readonly<Record<string, string>>) {
    const prepared: readonly PreparedSkill[] = await prepareSkills({
        ...options,
        verify(skill) {
            if (hashSkillBundle(skill.path) !== pins[skill.name]) {
                throw new InvalidAgentDefinitionError('Skill content does not match the reviewed pin.');
            }
        },
    });

    return loadSkillBundles(prepared.map((skill) => ({
        name: skill.name,
        directory: skill.path,
        version: options.revision,
        hash: pins[skill.name]!,
    })));
}
```

Review complete source bundles and record their hashes separately before invoking this helper. Pass app-owned source/commit, selected names, a dedicated output directory and those reviewed pins. A common profile can select `ponytail` and `codebase-design`. A maintainer can add `generate-commit-message`, `investigate-pr-comments`, `create-pull-request` and `release-please-version-bump`. Combine names/pins before building one catalog. Append its metadata-only instructions to the role and compose its `load_skill` tool with your existing tools, checking for a name collision.

Preparation verifies the actual cloned commit and requires the entire committed source tree to be symlink-free, including unrelated or unselected paths. It rejects source links before discovery/copying and fails closed if Git tree inspection fails. It rejects missing/duplicate names, copies supporting assets through the source SDK and invokes every verifier on staged records before replacing output. Verifiers must throw to reject and return no value on success; boolean comparisons are refused. The output is a dedicated managed corpus: a root `.chamvi-skills` marker permits later replacement, including removing old selections. Symlink targets and nonempty unowned targets are refused. Same-target preparations fail while a sibling guard exists; after a crash, remove the guard only after confirming no preparation remains active. A failed verifier or promotion keeps/restores old output; a backup survives if filesystem failure also prevents restoration.

Importing the package performs no preparation. It never changes cwd, invokes the skills CLI or executes source scripts. Preparation grants no tools, runtime approval or sandbox mounts. Runtime loading accepts any UTF-8 regular file inside the pinned bundle as passive reference text, regardless of extension, including source code and scripts. It rejects malformed UTF-8, NUL-bearing content, hidden paths, symlinks and special files, and never executes a reference. Git LFS files remain pointers; reviewed hashes detect omitted/changed source bytes. For the manual build workflow, copy prepared assets explicitly into runtime images. Runtime installation uses the engine-owned `gitSkills` provider.

The source backend is private to Chamvi. Consumers import only Chamvi APIs and keep their source/profile/pin configuration when the backend changes. See the [skills preparation reference](https://chamvi.dev/reference/skills), [runtime guide](https://chamvi.dev/guide/skills) and [backend migration issue97](https://github.com/chamvi/chamvi/issues/97).
