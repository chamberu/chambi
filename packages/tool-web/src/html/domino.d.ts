/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

declare module '@mixmark-io/domino' {
    /** Parses an HTML string into a DOM document (WHATWG parsing, no scripts run). */
    export function createDocument(html?: string, force?: boolean): Document;

    const domino: { createDocument: typeof createDocument };
    export default domino;
}
