/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createApp, defineAgent, http } from '@chamvi/app';
import { gitSkills, loadSkillBundle } from '@chamvi/skills';

const common = gitSkills({
    source: 'https://github.com/tada5hi/skills.git',
    revision: '0123456789abcdef0123456789abcdef01234567',
    directory: '/tmp/chamvi-skills/common',
    approved: [{
        name: 'ponytail',
        version: '1.0.0',
        hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    }],
});

const security = defineAgent({
    name: 'security',
    instructions: 'Audit only the operator-approved scope.',
    // This agent also receives the app defaults. A ready snapshot is an optional extra.
    skills: [loadSkillBundle({
        name: 'security-audit',
        version: '1.0.0',
        directory: '/opt/approved-skills/security-audit/1.0.0',
        hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    })],
    channels: [http.on()],
});

export default createApp({
    model: 'anthropic/claude-sonnet-4-6',
    skills: [common],
    agents: [security],
});
