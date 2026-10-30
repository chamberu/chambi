/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { FlexibleSchema } from 'ai';
import type { ModelRef } from '../model/types.ts';

export type ExtractOptions<T> = {
    schema: FlexibleSchema<T>;
    content: string;
    instructions?: string;
    model?: ModelRef;
};
