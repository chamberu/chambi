# @chamvi/skills

Prepare explicitly selected, commit-pinned skill sources for Chamvi's verified local runtime loader. This optional package requires Git and Node >=22.20.

```bash
npm install @chamvi/skills @chamvi/core
```

Call `prepareSkills({ source, revision, names, directory, verify? })` in an explicit setup/build task. The source is a local Git repository, Git URL or repository shorthand; revision is a full 40-character commit. The result is an ordered readonly list of `{ name, description, path }`, with absolute paths. Source configuration, role choices and independently reviewed content pins belong to your application.

```ts
import { InvalidAgentDefinitionError, hashSkillBundle, loadSkillBundles } from '@chamvi/app';
import { prepareSkills } from '@chamvi/skills';
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
        sha256: pins[skill.name]!,
    })));
}
```

Review complete source bundles and record their hashes separately before invoking this helper. Pass app-owned source/commit, selected names, a dedicated output directory and those reviewed pins. A common profile can select `ponytail` and `codebase-design`. A maintainer can add `generate-commit-message`, `investigate-pr-comments`, `create-pull-request` and `release-please-version-bump`. Combine names/pins before building one catalog. Append its metadata-only instructions to the role and compose its `load_skill` tool with your existing tools, checking for a name collision.

Preparation verifies the actual cloned commit, rejects missing/duplicate names, copies supporting assets through the source SDK and invokes every verifier on staged records before replacing output. Verifiers must throw to reject and return no value on success; boolean comparisons are refused. The output is a dedicated managed corpus: a root `.chamvi-skills` marker permits later replacement, including removing old selections. Symlink targets and nonempty unowned targets are refused. Same-target preparations fail while a sibling guard exists; after a crash, remove the guard only after confirming no preparation remains active. A failed verifier or promotion keeps/restores old output; a backup survives if filesystem failure also prevents restoration.

Importing the package performs no preparation. It never changes cwd, invokes the skills CLI or executes source scripts. Preparation grants no tools, runtime approval or sandbox mounts. Runtime loading still rejects scripts and unsupported assets. Git LFS files remain pointers; reviewed hashes detect omitted/changed source bytes. Copy prepared assets explicitly into runtime images and keep runtime startup on deployed bytes.

The source backend is private to Chamvi. Consumers import only Chamvi APIs and keep their source/profile/pin configuration when the backend changes. See the [skills preparation reference](https://chamvi.dev/reference/skills), [runtime guide](https://chamvi.dev/guide/skills) and [backend migration issue97](https://github.com/chamvi/chamvi/issues/97).
