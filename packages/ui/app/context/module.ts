/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { inject } from 'vue';
import { APP_CONTEXT } from './constants.ts';
import type { AppContext } from './types.ts';

export function useAppContext(): AppContext {
    const context = inject(APP_CONTEXT);

    if (!context) {
        throw new Error('The chamvi app context is not provided.');
    }

    return context;
}
