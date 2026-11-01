/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { defineContextKey } from '@chamvi/core';
import type { IKnowledge } from '../knowledge/types.ts';

/** The knowledge provided on the engine (one per app). */
export const KNOWLEDGE_CONTEXT = defineContextKey<IKnowledge>('knowledge');
