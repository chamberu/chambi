/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IPageVisibility } from './types.ts';

/** The document's visibility, or `undefined` outside a browser (tests, SSR). */
export function documentVisibility(): IPageVisibility | undefined {
    if (typeof document === 'undefined') {
        return undefined;
    }

    return {
        hidden: () => document.visibilityState === 'hidden',
        onChange(fn) {
            document.addEventListener('visibilitychange', fn);

            return () => document.removeEventListener('visibilitychange', fn);
        },
    };
}
