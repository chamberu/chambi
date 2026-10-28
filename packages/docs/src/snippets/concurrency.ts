/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModel } from 'ai';
import { defineAgent, httpModule } from '@chamvi/app';
import { github } from '@chamvi/github';
import { cron } from '@chamvi/channel-cron';

export function cappedAgent(model: LanguageModel) {
    // #region caps
    return defineAgent({
        name: 'triage',
        model,
        instructions: 'Inspect the issue or perform the scheduled sweep.',
        maxConcurrentRuns: 3, // shared-store ceiling for this agent
        channels: [
            github.on('issues.opened', { maxConcurrentRuns: 2 }),
            // No additional subscription ceiling; still inside the agent's three.
            cron.on('0 * * * *', { maxConcurrentRuns: false }),
        ],
    });
    // #endregion caps
}

// Include one of these in createApp({ modules: [...] }), alongside githubModule().
// #region finite-http
export const finiteGithubIntake = httpModule({
    // Example only: replace with the actual trusted ingress source CIDRs.
    trustProxy: ['10.42.0.0/16'],
    channelRateLimits: { github: { max: 3_000, windowMs: 60_000 } },
});
// #endregion finite-http

// #region unlimited-http
export const unlimitedGithubIntake = httpModule({ channelRateLimits: { github: false } });
// #endregion unlimited-http
