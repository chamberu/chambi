/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { defineContextKey } from '../context/module.ts';
import type { ModelContext } from './types.ts';

/** The engine's models for resolveModel(); set by the engine itself, never through provide(). */
export const MODEL_CONTEXT = defineContextKey<ModelContext>('model');
