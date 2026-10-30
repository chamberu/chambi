# Host-local Git and simple-git evaluation

Chamvi retains bounded `execFile` for host-local metadata in `packages/skills/src/prepare/module.ts` and fixture commands in `packages/test-kit/src/git-fixture/module.ts`. Neither package depends directly on simple-git. The pinned skills SDK continues to own cloning and bundle its private Git library; no fork or clone implementation was changed by this evaluation. Sandbox Git stays on `workspace.exec`.

The direct-client experiment inspected simple-git 4.0.2 with argv-parser 2.0.1, using its published `dist/index.mjs.map` primary source contents. Real-process tests reproduced two contract regressions:

| Inspected upstream source | Behavior relevant to Chamvi |
|---------------------------|-----------------------------|
| `src/lib/plugins/error-detection.plugin.ts`, `isTaskError` | Default error detection requires both a nonzero exit and stderr. Silent nonzero exits and external signal termination can resolve successfully. A failed `ls-tree` could therefore bypass the source-wide symlink preflight. |
| `src/lib/runners/git-executor-chain.ts`, `gitResponse` / `context.kill` | Aborts send SIGINT, set `spawned.killed` and do not escalate or destroy output pipes. Its output listeners keep accumulating chunks if the child ignores SIGINT. |
| `src/lib/plugins/abort-plugin.ts`, `src/lib/plugins/timeout-plugin.ts` | Abort/timeout use that kill path. The timeout also stops on process exit even while inherited pipes can remain open. |
| `src/lib/plugins/completion-detection.plugin.ts` | Waiting for close retains complete pipes but cannot bound a SIGINT-resistant child or its continuing buffered output. |

The user chose restoring `execFile` rather than adding a process wrapper, dependency patch or fork. Cost: host-local commands do not reuse the SDK's Git library. This preserves the original 30000ms metadata timeout, default 1048576-byte bounds independently per stream, SIGTERM behavior, rejection of silent failures/signals and fixture environment/raw-argument contract. Exact HEAD verification and source-wide tracked-symlink rejection still precede SDK discovery. Fixture calls have no timeout and remain independent after failures.

Finite real-process regressions cover each metadata command, silent nonzero exits, external SIGTERM, SIGINT-resistant stdout/stderr floods and output-producing deadline failures. Marker files prove termination before voluntary completion; the original SDK, exact-HEAD, symlink-confinement and integration tests remain intact.
