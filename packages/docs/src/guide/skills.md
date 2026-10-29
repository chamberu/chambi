# Approved Local Skills

An agent can opt into reviewed local instruction/reference bundles with `loadSkillBundles()` from `@chamvi/app`. Its initial instructions contain only approved metadata. The fixed `load_skill` tool returns a body or one reference when needed, through normal tool results and checkpoints. Importing the package does no bundle filesystem work.

## Review and pin

1. Review the complete bundle, including its description, body, references and license. Metadata is instruction-bearing text too.
2. Compute its digest separately with `hashSkillBundle('/opt/approved-skills/security-audit/1.0.0')`. The helper synchronously validates the passive bundle and returns a lowercase SHA-256. It identifies bytes; it does not approve them.
3. Commit the exact name, release identifier, absolute runtime directory and reviewed digest in the agent configuration. Never compute the expected `sha256` dynamically at startup: that would accept whatever content happens to be present.
4. Construct the catalog explicitly, append its instructions, and compose its tools with the agent's existing tools.

<<< ../snippets/skills.ts

The digest in this example is illustrative; replace it with the reviewed digest. `existingTools` represents tools the consuming agent already provides. Check for a `load_skill` name collision before composing: object spread silently overwrites duplicate names. For a per-execution tool factory, spread `catalog.tools` alongside the existing factory's result.

`loadSkillBundles()` synchronously verifies every descriptor before returning any catalog. Invalid configuration, unsupported content, unstable files or a pin mismatch throw `InvalidAgentDefinitionError` with source-relative diagnostics that omit file bodies. `catalog.skills` exposes name, description, version, digest and `ignoredFields`; catalog instructions include only the first four, sorted by name, with escaped metadata and no bodies, references or absolute host paths. An empty approved list returns empty metadata, instructions and tools.

## Prepare a pinned external source

Use optional [`@chamvi/skills`](/reference/skills) in an explicit setup/build task to prepare a selected Git source. The application owns the source URL, full commit, role choices and separately reviewed bundle pins. A common profile can select `ponytail` and `codebase-design`; a maintainer profile can add `generate-commit-message`, `investigate-pr-comments`, `create-pull-request` and `release-please-version-bump`. Combine the selected names and pins before creating one catalog, rather than merging independent `load_skill` tools.

Pass a `verify` callback that checks `hashSkillBundle(skill.path)` against each recorded pin. Every callback runs on staged copies before managed output is replaced. Keep role descriptors/pins in tracked agent configuration so a reviewed upgrade changes that agent's revision. Copy the prepared corpus explicitly into the runtime image and use `loadSkillBundles()` on those deployed bytes; do not download or install sources on agent import/startup.

Preparation copies text and supporting assets. It never enables tools, executes scripts or mounts files into sandboxes. Sources containing scripts or other unsupported assets require a separately reviewed passive adaptation before runtime loading. The source backend remains private to Chamvi; consumer configuration and API stay unchanged when it moves to an official SDK release.

## Bundle format and bounds

Each absolute directory must contain root `SKILL.md` with initial YAML frontmatter:

```markdown
---
name: security-audit
description: Review trust boundaries and report evidence for an operator-approved audit.
---

Read the scoped task and inspect its trust boundaries. Consult references/checklist.md as needed.
```

The frontmatter name must match the descriptor and `^[a-z][a-z0-9-]{0,63}$`. Surrounding description whitespace is trimmed before checking for a nonblank string of at most 1,024 characters. This accepts the trailing newline of a folded YAML description. Metadata keys and the trimmed description cannot contain control characters, including internal newlines and tabs. Duplicate keys, aliases, custom tags and nonstring keys are rejected. Other fields are informational only: `allowed-tools`, `model`, and similar fields grant no capabilities or settings. Their sorted names appear in `SkillMetadata.ignoredFields` for operator diagnostics.

A version is an exact, nonblank opaque release identifier of at most 128 characters. Whitespace, control characters, wildcard/range syntax (including `x` segments) and the case-insensitive rolling labels `latest`, `main`, `master`, `head` are rejected. The SHA-256 identifies content independently of this label.

| Bound | Maximum |
|---|---|
| Approved bundles per catalog | 16, with unique names |
| YAML frontmatter | 4 KiB |
| Markdown body | 64 KiB |
| Each supporting file | 128 KiB |
| Regular files, including `SKILL.md` | 64 |
| Total file bytes | 1 MiB |
| Inventory entries, including root and directories | 1,024 |
| Nested directory levels | 64 |

Supported files are UTF-8 `.md`, `.txt`, `.json`, `.yaml`, `.yml`, and exact basenames `LICENSE` and `NOTICE`. JSON and YAML supporting files (including `agents/openai.yaml`) are opaque reference text, never parsed as configuration or executed. Malformed UTF-8 and NUL-bearing content are rejected. Hidden paths, backslashes/control characters in paths, symlinks, special files, scripts, binaries and other file types are unsupported. Ordinary body/reference text may contain line breaks and tabs.

The digest covers every regular file, including README, LICENSE and references, without agent-folder ignore rules or newline normalization. Its framing is SHA-256 over `chamvi-skill-bundle-v1\n` (`\n` is one LF byte), then files in relative POSIX-path code-point order. For each file append decimal UTF-8 path-byte length, `:`, path bytes, decimal content-byte length, `:`, exact content bytes. Absolute roots, timestamps and empty directories do not contribute to the digest.

## Load only what is needed

The model calls the same tool for either form:

```json
{ "name": "security-audit" }
```

This returns the Markdown body after frontmatter. A reference can be requested directly, without loading the body first:

```json
{ "name": "security-audit", "reference": "references/checklist.md" }
```

Both return `LoadedSkill`: `{ name, version, sha256, reference, content, references }`. `reference` is `null` for the body; `references` is the sorted list of approved supporting paths in both forms. Reference paths use exact relative POSIX spelling. Absolute paths, backslashes, NUL, empty segments, `.`/`..`, unknown names/paths and `SKILL.md` as a reference fail with `ValidationError`, without reading the filesystem.

References are never followed automatically and Markdown URLs never fetch anything. Repeated or parallel calls return the same snapshot content, without an activation flag. Ordinary tool policy, hooks and durable approvals apply. Results reach the next model call and persisted run checkpoints; loading is per-run context, not remembered cross-run authorization. Future message compaction must preserve needed results and their identity; automatic compaction retention and delegation are outside this feature.

## Restart and deployment

The catalog privately snapshots reviewed bytes during setup. Later disk edits cannot change an existing catalog. Recreating it after a restart or approval pause verifies the pin again; changed bytes under the old pin fail closed before newer content can be used. Upgrade by reviewing the new complete bundle and changing its tracked descriptor digest together with the deployed files.

Keep source directories immutable and not attacker-writable during setup. Bounded no-follow reads, file identity checks and repeated inventories detect ordinary changes; portable filesystem checks do not provide a security boundary against a malicious concurrent host writer.

External bundle directories are not automatically watched and do not automatically change an agent revision. Keep the descriptor in tracked agent configuration and apply upgrades through the existing reload/restart workflow. Agent-folder hashing is not a substitute for the full bundle pin. Bundle files are runtime assets: copy them explicitly into the final app image at their configured absolute paths, readable by uid 1000. Deployment and run-job images must contain the same reviewed bytes.

## Policy and compatibility

Skills supply ordinary tool-result content under the agent's role instructions and operator policy. They do not add tools, permissions, network access, scripts, subagents or authorization to publish findings. Existing configured tools may act on this text, so passive loading provides no sandbox. Credential separation, sandbox isolation and private disclosure remain separate requirements for a security agent.

This is separate from scoped repository instructions: repository instructions and issue text cannot approve a bundle or turn an arbitrary workspace file into a skill. The runtime performs no workspace auto-discovery, marketplace installation, source URL fetch or dynamic tool registration.

Complex third-party skills require an explicitly reviewed adaptation to this passive subset. Cloudflare's security audit methodology, for example, does not become a compatible automated workflow merely by loading its text: script validation, isolation and independent subagents require separately supported capabilities. Future delegation and untrusted-content controls do not gain new APIs here.

See the [app reference](/reference/app#approved-local-skills) for the public types and helpers.
