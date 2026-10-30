/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import { CONFIG_ELEMENT_ID } from '../../src/config/constants.ts';
import type { UiConfig } from '../../src/config/types.ts';
import { DEV_CONFIG } from './constants.ts';

function isConfig(value: unknown): value is UiConfig {
    if (!isObject(value)) {
        return false;
    }

    const config = value as Partial<UiConfig>;

    return typeof config.apiBase === 'string' &&
        typeof config.uiBase === 'string' &&
        isObject(config.auth) &&
        typeof config.auth.tokens === 'boolean';
}

/** The config block `uiRoutes()` injects into `index.html`; `DEV_CONFIG` without one. */
export function readConfig(doc: Pick<Document, 'getElementById'>): UiConfig {
    const text = doc.getElementById(CONFIG_ELEMENT_ID)?.textContent;

    if (!text) {
        return DEV_CONFIG;
    }

    try {
        const value: unknown = JSON.parse(text);

        return isConfig(value) ? value : DEV_CONFIG;
    } catch {
        return DEV_CONFIG;
    }
}
