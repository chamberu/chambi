/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import type { GithubOctokit } from '../app/types.ts';
import { CHECKS_MAX } from './constants.ts';
import { statusOf } from './helpers.ts';
import type {
    GithubCheck,
    GithubCheckOutcome,
    GithubPullRequestChecks,
    RepoTarget,
} from './types.ts';

const SUCCESS_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

function stringOr<T>(value: unknown, fallback: T): string | T {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function checkRunOutcome(status: string, conclusion: string | null): GithubCheckOutcome {
    if (status !== 'completed') return 'pending';
    return conclusion !== null && SUCCESS_CONCLUSIONS.has(conclusion) ? 'success' : 'failure';
}

function statusOutcome(state: string): GithubCheckOutcome {
    if (state === 'success') return 'success';
    if (state === 'failure' || state === 'error') return 'failure';
    return 'pending';
}

/**
 * The state of `checks` against the required contexts: `failure` when any
 * check failed, else `pending` while one runs or a required context has no
 * report yet (`missing`), else `none` without any check, else `success`.
 */
export function summarizeChecks(
    checks: GithubCheck[],
    requiredContexts: string[],
): Pick<GithubPullRequestChecks, 'state' | 'pending' | 'failing'> & { missing: string[] } {
    const names = new Set(checks.map((check) => check.name));
    const missing = requiredContexts.filter((context) => !names.has(context));
    const failing = checks.filter((check) => check.outcome === 'failure').length;
    const pending = checks.filter((check) => check.outcome === 'pending').length;
    let state: GithubPullRequestChecks['state'] = 'success';
    if (failing > 0) state = 'failure';
    else if (pending + missing.length > 0) state = 'pending';
    else if (checks.length === 0) state = 'none';
    return {
        state, 
        pending, 
        failing, 
        missing, 
    };
}

/** A protection read that may be refused (403, 404): undefined then, any other failure thrown. */
async function readable<T>(read: () => Promise<T>): Promise<T | undefined> {
    try {
        return await read();
    } catch (error) {
        const status = statusOf(error);
        if (status === 403 || status === 404) return undefined;
        throw error;
    }
}

function contextsOfBranch(data: unknown): string[] {
    const protection = isObject(data) && isObject(data.protection) ? data.protection : {};
    const required = isObject(protection.required_status_checks) ? protection.required_status_checks : {};
    const contexts = Array.isArray(required.contexts) ? required.contexts.filter((c): c is string => typeof c === 'string') : [];
    const checks = Array.isArray(required.checks) ?
        required.checks.map((c: unknown) => (isObject(c) ? c.context : undefined)).filter((c): c is string => typeof c === 'string') :
        [];
    return [...contexts, ...checks];
}

function contextsOfRules(rules: unknown[]): string[] {
    const contexts: string[] = [];
    for (const rule of rules) {
        if (!isObject(rule) || rule.type !== 'required_status_checks' || !isObject(rule.parameters)) continue;
        const list = rule.parameters.required_status_checks;
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            if (isObject(item) && typeof item.context === 'string') contexts.push(item.context);
        }
    }
    return contexts;
}

/**
 * The checks of a pull request's head: the latest check runs (at most
 * CHECKS_MAX), the commit statuses (latest per context), and the required
 * contexts of the base branch's protection and rulesets.
 */
export async function readChecks(
    octokit: GithubOctokit,
    target: RepoTarget,
    pull: {
        number: number; 
        headSha: string; 
        base: string 
    },
): Promise<GithubPullRequestChecks> {
    const { owner, repo } = target;
    const runs: unknown[] = [];
    let truncated = false;
    const pages = octokit.paginate.iterator('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
        owner,
        repo,
        ref: pull.headSha,
        filter: 'latest',
        per_page: 100,
    });
    for await (const { data } of pages) {
        for (const item of data) {
            if (runs.length === CHECKS_MAX) {
                truncated = true;
                break;
            }
            runs.push(item);
        }
        if (truncated) break;
    }
    const { data: combined } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/status', {
        owner,
        repo,
        ref: pull.headSha,
        per_page: 100,
    });
    const branch = await readable(async () => (await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
        owner,
        repo,
        branch: pull.base,
    })).data);
    const rules = await readable(() => octokit.paginate('GET /repos/{owner}/{repo}/rules/branches/{branch}', {
        owner,
        repo,
        branch: pull.base,
        per_page: 100,
    }));
    const contexts = [...new Set([
        ...(branch ? contextsOfBranch(branch) : []),
        ...(rules ? contextsOfRules(rules as unknown[]) : []),
    ])];
    const required = new Set(contexts);

    const checks: GithubCheck[] = [];
    for (const item of runs) {
        if (!isObject(item)) continue;
        const name = String(item.name);
        const status = stringOr(item.status, 'queued');
        const conclusion = stringOr(item.conclusion, null);
        checks.push({
            name,
            kind: 'check_run',
            status,
            conclusion,
            outcome: checkRunOutcome(status, conclusion),
            required: required.has(name),
            url: stringOr(item.html_url, null) ?? stringOr(item.details_url, null),
        });
    }
    const statuses = isObject(combined) && Array.isArray(combined.statuses) ? combined.statuses : [];
    for (const item of statuses as unknown[]) {
        if (!isObject(item)) continue;
        const name = String(item.context);
        const state = stringOr(item.state, 'pending');
        checks.push({
            name,
            kind: 'status',
            status: state,
            conclusion: null,
            outcome: statusOutcome(state),
            required: required.has(name),
            url: stringOr(item.target_url, null),
        });
    }
    const summary = summarizeChecks(checks, contexts);
    return {
        number: pull.number,
        headSha: pull.headSha,
        base: pull.base,
        state: summary.state,
        pending: summary.pending,
        failing: summary.failing,
        checks,
        required: {
            known: branch !== undefined && rules !== undefined, 
            contexts, 
            missing: summary.missing, 
        },
        truncated,
    };
}
