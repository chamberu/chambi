/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { htmlToMarkdown as mdream } from 'mdream';
import { FRONTMATTER, PAGE_CHROME_ELEMENTS, TEXT_MEDIA_TYPES } from './constants.ts';
import type { ConvertedPage } from './types.ts';

/** The lower-cased `type/subtype` of a content type, else undefined. */
export function mediaTypeOf(contentType: string | null): string | undefined {
    const type = contentType?.split(';')[0]?.trim().toLowerCase();
    return type || undefined;
}

export function isHtml(contentType: string | null): boolean {
    const type = mediaTypeOf(contentType);
    return type === 'text/html' || type === 'application/xhtml+xml';
}

/** True for a type readable as text: `text/*`, JSON, XML, scripts, a `+json`/`+xml` suffix, or none given. */
export function isText(contentType: string | null): boolean {
    const type = mediaTypeOf(contentType);
    if (!type) return true;
    return type.startsWith('text/') ||
        TEXT_MEDIA_TYPES.has(type) ||
        type.endsWith('+json') ||
        type.endsWith('+xml');
}

function decoderFor(label: string | undefined): TextDecoder | undefined {
    if (!label) return undefined;
    try {
        return new TextDecoder(label);
    } catch {
        return undefined;
    }
}

/**
 * The body as text: the content type's charset, else (for HTML) a
 * `<meta charset>` in the first 1024 bytes, else UTF-8.
 */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
    const declared = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? '')?.[1];
    let decoder = decoderFor(declared);
    if (!decoder && isHtml(contentType)) {
        const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
        decoder = decoderFor(/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1]);
    }
    return (decoder ?? new TextDecoder()).decode(bytes);
}

/** The page's readable part: `<main>`, else its only `<article>`, else `<body>`; chrome dropped. */
function convert(html: string, baseUrl: string, format: 'markdown' | 'text'): ConvertedPage {
    let title: string | undefined;
    const frontmatter = (fields: Record<string, string>) => {
        title = fields.title?.replace(/\s+/g, ' ').trim() || undefined;
    };
    // the page's main content first; a page without main or article (or a fragment)
    // isolates to nothing, so then the whole body without navigation and forms
    // emptyLinks: javascript: and data: links become their text
    const clean = { emptyLinks: true };
    let content = mdream(html, {
        origin: baseUrl, 
        minimal: true, 
        format, 
        frontmatter, 
        clean,
    });
    if (content.replace(FRONTMATTER, '').trim() === '') {
        content = mdream(html, {
            origin: baseUrl, 
            format, 
            frontmatter, 
            clean, 
            filter: { exclude: [...PAGE_CHROME_ELEMENTS] },
        });
    }
    content = content.replace(FRONTMATTER, '').trim();
    return title === undefined ? { content } : { title, content };
}

/** An HTML page as markdown (mdream), links and images absolute against `baseUrl`. */
export function htmlToMarkdown(html: string, baseUrl: string): ConvertedPage {
    return convert(html, baseUrl, 'markdown');
}

/** An HTML page as plain text (mdream). */
export function htmlToText(html: string, baseUrl: string): ConvertedPage {
    return convert(html, baseUrl, 'text');
}
