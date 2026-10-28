/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { defineAgent, http, loadSkillBundles } from '@chamvi/app';

const catalog = loadSkillBundles([{
    name: 'security-audit',
    version: '1.0.0',
    directory: '/opt/approved-skills/security-audit/1.0.0',
    sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
}]);
const existingTools: ToolSet = {};

export default defineAgent({
    name: 'security',
    instructions: `Audit only the operator-approved scope.\n\n${catalog.instructions}`,
    tools: { ...existingTools, ...catalog.tools },
    channels: [http.on()],
});
