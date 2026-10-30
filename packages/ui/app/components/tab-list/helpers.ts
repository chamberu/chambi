/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/**
 * The tab a key moves to in a horizontal tab list (ARIA tabs pattern):
 * ArrowLeft/ArrowRight wrap around, Home and End jump to the ends; any other key `undefined`.
 */
export function tabForKey<T extends string>(tabs: readonly T[], current: T, key: string): T | undefined {
    const index = tabs.indexOf(current);

    if (tabs.length === 0) {
        return undefined;
    }

    switch (key) {
        case 'ArrowRight': return tabs[(index + 1) % tabs.length];
        case 'ArrowLeft': return tabs[(index - 1 + tabs.length) % tabs.length];
        case 'Home': return tabs[0];
        case 'End': return tabs[tabs.length - 1];
        default: return undefined;
    }
}

export const tabId = (prefix: string, tab: string) => `${prefix}-tab-${tab}`;

export const panelId = (prefix: string) => `${prefix}-panel`;

/** Selects (via `select`) and focuses the tab a key moves to; other keys are left alone. */
export function onTabKeydown<T extends string>(
    event: KeyboardEvent,
    tabs: readonly T[],
    current: T,
    prefix: string,
    select: (tab: T) => Promise<void> | void,
): void {
    const next = tabForKey(tabs, current, event.key);

    if (next === undefined) {
        return;
    }

    event.preventDefault();

    const list = event.currentTarget;

    void Promise.resolve(select(next)).then(() => {
        if (list instanceof HTMLElement) {
            list.querySelector<HTMLElement>(`#${CSS.escape(tabId(prefix, next))}`)?.focus();
        }
    });
}
