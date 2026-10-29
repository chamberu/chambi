# Approved Skills

Configure `createApp({ skills })` or `new Engine({ skills })` with reviewed defaults for every agent. An agent's `skills` adds extras. Inputs are immutable ready `Skill` snapshots or `ISkillSource` providers. The engine automatically adds metadata instructions and one scoped `load_skill` tool, so another agent's extras stay private. No user tools or state are required.

## Review and pin

1. Review every bundle's description, body, references and license. Metadata is instruction-bearing text too.
2. Compute its digest separately with `hashSkillBundle(directory)` from `@chamvi/skills`. This validates supported passive files and identifies their bytes; computing a hash grants no approval.
3. Record the exact name, version, full source commit and independently reviewed digest. Never compute expected pins dynamically at startup.
4. Use `gitSkills()` for startup preparation, or `loadSkillBundle()` for an already deployed local snapshot. Filesystem helpers live in optional `@chamvi/skills`; core and app have no dependency on that package.

<<< ../snippets/skills.ts

The commit and digests above are illustrative. Replace them with reviewed pins. `gitSkills` is a pure factory: imports and source declaration do no installation. `loadSkillBundle` reads and verifies the local directory when explicitly called, returning a ready snapshot. Supply several ready snapshots/providers in the same `skills` array; never merge independent `load_skill` tools. Effective selections allow at most 16 unique names. Conflicting names or content reject, while identical snapshots deduplicate. A user tool named `load_skill`, including a factory-produced tool, is rejected when first-class skills are configured.

For direct engine use, pass the same source and ready snapshot to core:

<<< ../snippets/skills-engine.ts

## Startup preparation

`Engine.prepare({ signal?, agents? })` prepares defaults and registered agents, plus optional candidates without registration or store writes. `Engine.start({ signal? })` also waits for preparation before recovery, queue execution or channel startup. Successful provider results are memoized per engine. Failed/canceled attempts may be deliberately retried after their owned work settles; no unverified fallback is used.

App startup prepares defaults and code agents before exposing the engine or running `engineCreated` hooks. It then statically checks and prepares folder candidates before registering revisions. Required verification failure aborts setup before channels, HTTP serving or model work. Ordinary folder syntax/model/channel failures remain load issues. A failed skill hot reload records an agent issue and keeps the old agent and revision. Preparation retries after twice the polling interval, then doubles the delay up to the greater of one minute or the polling interval; retries run on regular polls. A folder edit resets the delay, and successful recovery clears the issue. This also lets temporary source failures recover without an edit. Store setup may already have occurred before verification.

`app.check()` and `chamvi start --check` are static and read-only: no skill provider calls, installation, network or configuration writes. They check declared headers and static tool collisions, and defer remote content verification until startup. Tool factories are not evaluated by these checks; a factory returning `load_skill` is rejected when tools are assembled during execution, before model use. Explicit I/O performed by application imports, including a top-level `loadSkillBundle`, remains application-owned. Migrate skips skill preparation. App run-job mode prepares during setup; direct cron `runJob` passes caller cancellation into engine startup and retains its normal stored-status/exit-code mapping.

## Prepare a pinned external source

`gitSkills({ source, revision, directory, approved })` from the skills main entry selects exactly the reviewed names and verifies their staged contents before replacing the managed corpus. The full cloned commit must match the pin and the entire committed source must be symlink-free, including unselected paths. Supporting files may use any extension, including source code, scripts and SVG, provided they contain valid UTF-8 text. They remain passive references and are never executed by the loader. Source credentials and configuration belong to the operator.

For explicit setup/build workflows, `prepareSkills()` remains available with a staged `verify` callback. `loadSkillBundles(approved)` remains the manual catalog API: append `catalog.instructions` and compose `catalog.tools` yourself, checking for an existing `load_skill`. Do not combine a manual catalog tool with first-class skills on the same agent. The [skills reference](/reference/skills) includes the unchanged manual consumer example.

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

Supporting files may have any extension or no extension. Every regular file inside the bundle is included in its reviewed hash and exposed as opaque UTF-8 reference text, including source code, scripts, SVG and `agents/openai.yaml`; the loader does not parse supporting files as configuration or execute them. Malformed UTF-8 and NUL-bearing content are rejected. Hidden paths, backslashes/control characters in paths, symlinks, special files and binary content remain unsupported. References cannot leave the pinned bundle. Ordinary body/reference text may contain line breaks and tabs.

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

Both return `LoadedSkill`: `{ name, version, hash, reference, content, references }`. `reference` is `null` for the body; `references` is the sorted list of approved supporting paths in both forms. Reference paths use exact relative POSIX spelling. Absolute paths, backslashes, NUL, empty segments, `.`/`..`, unknown names/paths and `SKILL.md` as a reference fail with `ValidationError`, without reading the filesystem.

References are never followed automatically and Markdown URLs never fetch anything. Repeated or parallel calls return the same snapshot content, without an activation flag. Ordinary tool policy, hooks and durable approvals apply. Results reach the next model call and persisted run checkpoints; loading is per-run context, not remembered cross-run authorization. Future message compaction must preserve needed results and their identity; automatic compaction retention and delegation are outside this feature.

## Restart and deployment

The engine privately snapshots verified bytes during preparation. Later disk edits cannot change an existing catalog. Recreating it after a restart or approval pause verifies the pin again; changed bytes under the old pin fail closed before newer content can be used. Upgrade by reviewing the new complete bundle and changing its tracked descriptor digest together with the deployed files.

Keep source directories immutable and not attacker-writable during setup. Bounded no-follow reads, file identity checks and repeated inventories detect ordinary changes; portable filesystem checks do not provide a security boundary against a malicious concurrent host writer.

Global skill configuration changes and external bundle directories are not automatically watched and do not change folder hashes. Saved load results retain their original checkpoint bytes and identity; after a reviewed pin upgrade, pending or future loads use the current verified snapshot. Existing replay-on-current-definition semantics remain: to avoid mixed-version disclosure, finish or explicitly cancel unsettled runs before changing global pins. Tracked agent extra-pin edits use existing revision cancellation. No stronger recovery identity is added. Keep the descriptor in tracked agent configuration and apply upgrades through the existing reload/restart workflow. Agent-folder hashing is not a substitute for the full bundle pin. Bundle files are runtime assets: copy them explicitly into the final app image at their configured absolute paths, readable by uid 1000. Deployment and run-job images must contain the same reviewed bytes.

Startup Git providers require `@chamvi/skills` as a runtime dependency, Node >=22.20, Git, source network access/credentials, temporary space and a writable managed corpus directory. The base `ghcr.io/chamvi/node:24` image currently has no Git; install it in a derived runtime image when using Git sources. A read-only root needs explicit writable mounts, for example `/tmp/chamvi-skills` on the chart's `/tmp` volume. Give each independent corpus a distinct directory; same-target concurrent preparation is refused. Both Deployment and CronJob images need this configuration.

Cloning and verification add startup latency before HTTP/probes are available. Size startup probes and termination grace accordingly. Stop aborts preparation and joins actual cleanup; the source SDK cannot cancel an in-flight clone, so stop may wait for clone settlement. Promotion/rollback completes before cancellation is reported. A prebuilt local snapshot avoids startup network and Git requirements.

## Policy and compatibility

Skills supply ordinary tool-result content under the agent's role instructions and operator policy. They do not add tools, permissions, network access, script execution, subagents or authorization to publish findings. Existing configured tools may act on this text, so passive loading provides no sandbox. Credential separation, sandbox isolation and private disclosure remain separate requirements for a security agent.

This is separate from scoped repository instructions: repository instructions and issue text cannot approve a bundle or turn an arbitrary workspace file into a skill. The runtime performs no workspace auto-discovery, marketplace search or dynamic capability grants. Only explicitly configured pinned sources are fetched during preparation.

Complex third-party skills require an explicitly reviewed adaptation to this passive subset. Cloudflare's security audit methodology, for example, does not become a compatible automated workflow merely by loading its text: script validation, isolation and independent subagents require separately supported capabilities. Future delegation and untrusted-content controls do not gain new APIs here.

See the [app reference](/reference/app#approved-local-skills) for the public types and helpers.
