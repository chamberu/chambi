/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import { matchesGlob } from 'node:path';
import type { ToolSet } from 'ai';
import {
    InvalidAgentDefinitionError,
    ValidationError,
    defineEffectTool,
    effectMarker,
} from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import { isObject } from 'smob';
import type { GithubOctokit, GithubProposalsOptions, IGithubApp } from '../app/types.ts';
import {
    REPO_PROPERTY,
    objectSchema,
    parseRepo,
    requireString,
    withOctokit,
} from './helpers.ts';
import { createPullRequest, toCreated } from './pull-operation.ts';
import type { GithubCreatedPullRequest, GithubProposeChangeInput, RepoTarget } from './types.ts';

/** Root folders whose files steer CI, hooks or review, refused whatever the allowlist says. */
const FORBIDDEN_ROOTS = new Set(['.github', '.husky']);

/** File names refused in any folder: review ownership and submodule targets. */
const FORBIDDEN_NAMES = new Set(['codeowners', '.gitmodules']);

/**
 * No normalization: accepting a different spelling could bypass the allowlist or target a different file.
 * Unicode format characters (category Cf: bidi overrides, zero-width joiners) are refused, since they
 * make a path (and the PR title built from it) read differently from what GitHub writes.
 */
function safePath(path: string): boolean {
    const printable = Array.from(path).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);
    const parts = path.split('/');

    return path.length > 0 && path.trim() === path && printable &&
        !/\p{Cf}/u.test(path) &&
        !/[\\%:#?]/.test(path) &&
        parts.every((part) => part !== '' && part !== '.' && part !== '..') &&
        !FORBIDDEN_ROOTS.has(parts[0]!.toLowerCase()) &&
        parts.every((part) => !FORBIDDEN_NAMES.has(part.toLowerCase()));
}

/** Validate and snapshot policy before any tools can be built, retaining no caller-owned objects. */
export function normalizeProposals(input: GithubProposalsOptions | undefined): GithubProposalsOptions | undefined {
    if (input === undefined) {
        return undefined;
    }

    if (!isObject(input) || !isObject(input.repos) || Array.isArray(input.repos)) {
        throw new InvalidAgentDefinitionError('proposals.repos must be a repository allowlist.');
    }

    const repos: GithubProposalsOptions['repos'] = {};

    for (const [name, policy] of Object.entries(input.repos)) {
        try {
            parseRepo(name);
        } catch {
            throw new InvalidAgentDefinitionError('proposals.repos keys must look like owner/name.');
        }

        const validPaths = isObject(policy) && Array.isArray(policy.paths) && policy.paths.length > 0 &&
            policy.paths.every((path: unknown) => typeof path === 'string' && safePath(path.replaceAll('?', 'x')));

        if (!validPaths) {
            throw new InvalidAgentDefinitionError('proposals.repos paths must be non-empty, safe repository-relative globs (not .github, .husky, CODEOWNERS or .gitmodules).');
        }

        const key = name.toLowerCase();

        if (repos[key]) {
            throw new InvalidAgentDefinitionError('proposals.repos contains duplicate repositories.');
        }

        repos[key] = { paths: [...policy.paths] };
    }

    return { repos };
}

function allowedPath(path: string, repo: string, policy: GithubProposalsOptions): boolean {
    return typeof path === 'string' && safePath(path) &&
        (policy.repos[repo.toLowerCase()]?.paths.some((pattern) => matchesGlob(path, pattern)) ?? false);
}

function validate(input: GithubProposeChangeInput, policy: GithubProposalsOptions): RepoTarget {
    const target = parseRepo(input.repo);
    const allowed = allowedPath(input.path, input.repo, policy);

    if (!allowed) {
        throw new ValidationError('Proposal repository/path is not allowed (unsafe paths, .github, .husky, CODEOWNERS and .gitmodules are always forbidden).');
    }

    if (typeof input.content !== 'string') {
        throw new ValidationError('content must be a string.');
    }

    requireString(input.reason, 'reason');

    return target;
}

/**
 * One effect per run, repository, path and content: a corrected proposal (another
 * content approved for the same path) is a new effect, never the recorded first one.
 */
function proposalKey(input: GithubProposeChangeInput, ctx: ToolContext): string {
    const content = createHash('sha256').update(input.content).digest('hex');

    return `${ctx.run.runId}:propose:${input.repo.toLowerCase()}:${input.path}:${content}`;
}

function proposalBranch(input: GithubProposeChangeInput, ctx: ToolContext): string {
    const slug = input.path.toLowerCase().replaceAll(/[^a-z0-9-]+/g, '-').slice(0, 80).replaceAll(/^-+|-+$/g, '') || 'file';
    const hash = createHash('sha256').update(input.path).digest('hex').slice(0, 16);
    const { agent } = ctx.run;

    return `chamvi/${agent}/${slug}-${hash}`;
}

function isNotFound(error: unknown): boolean {
    return isObject(error) && error.status === 404;
}

async function headOf(octokit: GithubOctokit, target: RepoTarget, branch: string): Promise<string> {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
        ...target,
        ref: `heads/${branch}`,
    });

    return data.object.sha;
}

async function assertHead(octokit: GithubOctokit, target: RepoTarget, branch: string, sha: string): Promise<void> {
    if (await headOf(octokit, target, branch) !== sha) {
        throw new ValidationError('Proposal branch moved during execution; retry after reviewing concurrent writes.');
    }
}

/** Contents dereferences symlinks. Walk the pinned Git tree instead, including every parent directory. */
async function readFile(octokit: GithubOctokit, target: RepoTarget, path: string, sha: string) {
    const { data: commit } = await octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
        ...target,
        commit_sha: sha,
    });
    let tree = commit.tree.sha;
    const parts = path.split('/');

    for (const [index, part] of parts.entries()) {
        const { data } = await octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
            ...target,
            tree_sha: tree,
        });

        if (data.truncated) {
            throw new ValidationError('Proposal tree is truncated.');
        }

        const entry = data.tree.find((item) => item.path === part);

        if (!entry) {
            return {
                tree: commit.tree.sha,
                mode: '100644' as const,
                content: undefined,
            };
        }

        if (index < parts.length - 1) {
            if (entry.type !== 'tree' || entry.mode !== '040000' || !entry.sha) {
                throw new ValidationError('Proposal parent must be a directory, not a symlink or submodule.');
            }

            tree = entry.sha;
        } else {
            if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode ?? '') || !entry.sha) {
                throw new ValidationError('Proposal path must be a regular file.');
            }

            const { data: blob } = await octokit.request('GET /repos/{owner}/{repo}/git/blobs/{file_sha}', {
                ...target,
                file_sha: entry.sha,
            });

            if (blob.encoding !== 'base64') {
                throw new ValidationError('Proposal blob must be Base64 encoded.');
            }

            return {
                tree: commit.tree.sha,
                mode: entry.mode as '100644' | '100755',
                content: Buffer.from(blob.content, 'base64').toString('utf8'),
            };
        }
    }

    throw new ValidationError('Proposal path must not be empty.');
}

const MAX_PULL_PAGES = 10;
const MAX_HISTORY_COMMITS = 250;
const MAX_GENERATIONS = 250;

/** The PRs of one head branch (`head=<owner>:<branch>`), never a scan of the repository's PRs. */
async function pullsOf(octokit: GithubOctokit, target: RepoTarget, branch: string) {
    const pulls = [];
    let pageCount = 0;
    const pages = octokit.paginate.iterator('GET /repos/{owner}/{repo}/pulls', {
        ...target,
        state: 'all',
        head: `${target.owner}:${branch}`,
        per_page: 100,
    });

    for await (const page of pages) {
        pageCount += 1;

        // A full final page may have more results. Never select a generation from
        // incomplete discovery, even if the matching PRs were on earlier pages.
        if (pageCount >= MAX_PULL_PAGES && page.data.length >= 100) {
            throw new ValidationError('Proposal PR discovery limit exceeded; manual review is required.');
        }

        pulls.push(...page.data.filter((item) => item.head.ref === branch &&
            item.head.repo?.full_name.toLowerCase() === `${target.owner}/${target.repo}`.toLowerCase()));
    }

    return pulls;
}

/**
 * Every generation of a proposal: the root branch, then `<root>-g-<n>` with `n` the
 * highest PR number seen so far (the branch `selectBranch` names), until a generation
 * has no PR. Each step is one filtered request, so the repository's PR count is irrelevant.
 */
async function findPulls(octokit: GithubOctokit, target: RepoTarget, root: string) {
    const pulls: Awaited<ReturnType<typeof pullsOf>> = [];
    const seen = new Set<string>();
    let branch = root;

    for (let generation = 0; generation < MAX_GENERATIONS; generation += 1) {
        seen.add(branch);
        pulls.push(...await pullsOf(octokit, target, branch));

        const previous = Math.max(0, ...pulls.map((pull) => pull.number));
        const next = `${root}-g-${previous}`;

        if (previous === 0 || seen.has(next)) {
            return pulls;
        }

        branch = next;
    }

    throw new ValidationError('Proposal generation limit exceeded; manual review is required.');
}

type ProposalPull = Awaited<ReturnType<typeof findPulls>>[number];

function selectBranch(root: string, pulls: ProposalPull[]): string {
    const open = pulls.filter((pull) => pull.state === 'open');

    if (open.length > 1) {
        throw new ValidationError('Multiple open proposal branches require manual review.');
    }

    // All runs converge on the same next generation, including retries before PR creation.
    const previous = Math.max(0, ...pulls.map((pull) => pull.number));

    return open[0]?.head.ref ?? (previous === 0 ? root : `${root}-g-${previous}`);
}

async function pullHasEffect(
    octokit: GithubOctokit,
    target: RepoTarget,
    pull: ProposalPull,
    marker: string,
): Promise<{ found: boolean; commits: number }> {
    // GitHub retains PR commits after merge/deletion. Comparing today's base SHA
    // to the head instead can erase the very commits needed for reconciliation.
    const pages = octokit.paginate.iterator('GET /repos/{owner}/{repo}/pulls/{pull_number}/commits', {
        ...target,
        pull_number: pull.number,
        per_page: 100,
    });
    let inspected = 0;

    for await (const page of pages) {
        inspected += page.data.length;

        // Positive evidence is sufficient even if the remaining history is capped.
        const found = page.data.some((commit) => commit.commit.message.includes(marker) &&
            commit.commit.message.includes(`<!-- chamvi:proposal=${pull.head.ref} -->`));

        if (found) {
            return { found: true, commits: inspected };
        }

        // The PR endpoint silently caps results at 250 commits. Never infer absence there.
        if (inspected >= MAX_HISTORY_COMMITS) {
            throw new ValidationError('Proposal history limit exceeded; manual review is required.');
        }
    }

    return { found: false, commits: inspected };
}

async function orphanHasEffect(
    octokit: GithubOctokit,
    target: RepoTarget,
    sha: string,
    base: string,
    marker: string,
    branch: string,
): Promise<boolean> {
    // An unpublished branch has no PR commit list. Only follow its tool-owned,
    // single-parent chain, refusing ambiguity rather than missing an older effect.
    let remaining = MAX_HISTORY_COMMITS;

    while (sha !== base && remaining > 0) {
        remaining -= 1;

        const { data: commit } = await octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
            ...target,
            commit_sha: sha,
        });

        if (!commit.message.includes(`<!-- chamvi:proposal=${branch} -->`)) {
            throw new ValidationError('Proposal commit ancestry is not proposal-owned; manual review is required.');
        }

        if (commit.parents.length !== 1 || !commit.parents[0]?.sha) {
            throw new ValidationError('Proposal commit ancestry is not a single-parent chain; manual review is required.');
        }

        if (commit.message.includes(marker)) {
            return true;
        }

        sha = commit.parents[0].sha;
    }

    if (sha !== base) {
        throw new ValidationError('Proposal history limit exceeded; manual review is required.');
    }

    return false;
}

/** Compare files are only returned on page one, capped at 300. Reject the cap rather than trusting a truncated diff. */
async function checkDiff(octokit: GithubOctokit, target: RepoTarget, base: string, branch: string, policy: GithubProposalsOptions) {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/compare/{basehead}', {
        ...target,
        basehead: `${base}...${branch}`,
        per_page: 1,
    });
    const { files } = data;
    const safe = files !== undefined && files.length < 300 && files.every((file) =>
        allowedPath(file.filename, `${target.owner}/${target.repo}`, policy) &&
        (!file.previous_filename || allowedPath(file.previous_filename, `${target.owner}/${target.repo}`, policy)));

    if (!safe) {
        throw new ValidationError('Proposal branch diff is unavailable, truncated, or contains disallowed paths.');
    }

    return data;
}

export function createProposalTools(app: IGithubApp, policy: GithubProposalsOptions): ToolSet {
    return {
        github_propose_change: defineEffectTool<GithubProposeChangeInput, GithubCreatedPullRequest>({
            trust: { guardWhenTainted: true },
            description: 'Propose replacement file content in an allowlisted repository/path. Creates or updates one stable branch and open PR for this agent and path. Never merges; .github, .husky, CODEOWNERS and .gitmodules paths are forbidden.',
            inputSchema: objectSchema<GithubProposeChangeInput>({
                repo: REPO_PROPERTY,
                path: { type: 'string', minLength: 1 },
                content: { type: 'string' },
                reason: { type: 'string', minLength: 1 },
            }, ['repo', 'path', 'content', 'reason']),
            effectKey(input, ctx) {
                validate(input, policy);

                return proposalKey(input, ctx);
            },
            async alreadyApplied(key, input, ctx) {
                const target = validate(input, policy);
                const root = proposalBranch(input, ctx);

                return withOctokit(app, ctx, target, async (octokit) => {
                    const pulls = await findPulls(octokit, target, root);

                    for (const pull of pulls) {
                        if (!pull.body?.includes(`<!-- chamvi:proposal=${pull.head.ref} -->`)) {
                            throw new ValidationError('Existing proposal PR is not proposal-owned.');
                        }

                        // A later run replaces the body and tip marker, but not commit ancestry.
                        // The PR head SHA also survives merge and deletion of its branch.
                        if ((await pullHasEffect(octokit, target, pull, effectMarker(key))).found) {
                            if (pull.state === 'open') {
                                const base = await headOf(octokit, target, pull.base.ref);

                                await checkDiff(octokit, target, base, pull.head.sha, policy);
                                await readFile(octokit, target, input.path, pull.head.sha);
                                await assertHead(octokit, target, pull.head.ref, pull.head.sha);
                                await assertHead(octokit, target, pull.base.ref, base);
                            }

                            return toCreated(pull);
                        }
                    }

                    return undefined;
                });
            },
            async execute(input, options) {
                const target = validate(input, policy);
                const ctx = options.context;
                const root = proposalBranch(input, ctx);
                const effect = effectMarker(proposalKey(input, ctx));
                const title = `Propose change to ${input.path}`.slice(0, 256);

                return withOctokit(app, ctx, target, async (octokit) => {
                    const pulls = await findPulls(octokit, target, root);
                    const branch = selectBranch(root, pulls);
                    const pull = pulls.find((item) => item.head.ref === branch && item.state === 'open');
                    const marker = `<!-- chamvi:proposal=${branch} -->`;
                    const body = `${input.reason}\n\n${marker}\n${effect}`;
                    const { data: repository } = await octokit.request('GET /repos/{owner}/{repo}', target);
                    const base = pull?.base.ref ?? repository.default_branch;
                    const baseSha = await headOf(octokit, target, base);

                    if (pull && !pull.body?.includes(marker)) {
                        throw new ValidationError('Existing proposal PR is not proposal-owned.');
                    }

                    let head: string;

                    try {
                        head = await headOf(octokit, target, branch);
                    } catch (error) {
                        if (!isNotFound(error)) {
                            throw error;
                        }

                        head = baseSha;
                        await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
                            ...target,
                            ref: `refs/heads/${branch}`,
                            sha: head,
                        });
                    }

                    const diff = await checkDiff(octokit, target, baseSha, head, policy);
                    const { data: commit } = await octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
                        ...target,
                        commit_sha: head,
                    });

                    if (!pull && diff.status !== 'identical' && !commit.message.includes(marker)) {
                        throw new ValidationError('Existing proposal branch is not proposal-owned.');
                    }

                    if (!pull && !diff.merge_base_commit?.sha) {
                        throw new ValidationError('Proposal merge base is unavailable; manual review is required.');
                    }

                    // Finish publication after a lost checkpoint without overwriting a later run.
                    const history = pull ? await pullHasEffect(octokit, target, pull, effect) : undefined;
                    const applied = history?.found ?? await orphanHasEffect(octokit, target, head, diff.merge_base_commit.sha, effect, branch);
                    const file = await readFile(octokit, target, input.path, head);

                    if (!applied) {
                        if (history && history.commits >= MAX_HISTORY_COMMITS - 1) {
                            throw new ValidationError('Proposal PR is at its history capacity; close or merge it before proposing another update.');
                        }

                        if (!pull && diff.status === 'identical' && file.content === input.content) {
                            throw new ValidationError('Proposal content already matches the base; no pull request is needed.');
                        }

                        let { tree } = file;

                        if (file.content !== input.content) {
                            const { data: updated } = await octokit.request('POST /repos/{owner}/{repo}/git/trees', {
                                ...target,
                                base_tree: tree,
                                tree: [{
                                    path: input.path,
                                    mode: file.mode,
                                    type: 'blob',
                                    content: input.content,
                                }],
                            });

                            tree = updated.sha;
                        }

                        // An unchanged file still needs a durable per-run marker for cross-run replay safety.
                        const { data: next } = await octokit.request('POST /repos/{owner}/{repo}/git/commits', {
                            ...target,
                            message: `${title}\n\n${marker}\n${effect}`,
                            tree,
                            parents: [head],
                        });

                        await checkDiff(octokit, target, baseSha, next.sha, policy);
                        await assertHead(octokit, target, branch, head);
                        await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
                            ...target,
                            ref: `heads/${branch}`,
                            sha: next.sha,
                            force: false,
                        });
                        head = next.sha;
                    }

                    const finalDiff = await checkDiff(octokit, target, baseSha, head, policy);

                    if (!pull && finalDiff.files?.length === 0) {
                        throw new ValidationError('Proposal content already matches the base; no pull request is needed.');
                    }

                    await assertHead(octokit, target, branch, head);
                    await assertHead(octokit, target, base, baseSha);

                    const result = pull ? await octokit.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', {
                        ...target,
                        pull_number: pull.number,
                        title,
                        body,
                    }).then(({ data }) => toCreated(data)) : await createPullRequest(octokit, target, {
                        head: branch,
                        base,
                        title,
                        body,
                    });

                    // The base is not re-checked here: a busy default branch moving after
                    // the PR write would report an applied effect as a failure.
                    await assertHead(octokit, target, branch, head);

                    return result;
                });
            },
        }),
    };
}
