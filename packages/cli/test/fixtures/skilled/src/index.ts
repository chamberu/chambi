/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createApp } from '@chamvi/app';
import { echo } from '../../app/src/agents.ts';

// the folder agents (CHAMVI_AGENTS_DIR=../agents) use echo's model as the app default
export default createApp({ agents: [echo], model: echo.definition.model });
