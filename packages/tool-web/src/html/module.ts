/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import domino from '@mixmark-io/domino';
import TurndownService from 'turndown';
import {
    BLOCK_ELEMENTS,
    DROPPED_ELEMENTS,
    LINK_PROTOCOLS,
    TEXT_MEDIA_TYPES,
} from './constants.ts';

export type ConvertedPage = {
    title?: string;
    content: string;
};

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
function readableRoot(document: Document): Element {
    for (const element of Array.from(document.querySelectorAll(DROPPED_ELEMENTS))) element.remove();
    const main = document.querySelector('main');
    if (main) return main;
    const articles = document.querySelectorAll('article');
    if (articles.length === 1) return articles[0]!;
    return document.body ?? document.documentElement;
}

function titleOf(document: Document): string | undefined {
    const title = document.title.replace(/\s+/g, ' ').trim();
    return title || undefined;
}

/** `value` resolved against `base`, else undefined for a scheme a link may not carry. */
function absolute(value: string, base: string): string | undefined {
    try {
        const url = new URL(value, base);
        return LINK_PROTOCOLS.has(url.protocol) ? url.href : undefined;
    } catch {
        return undefined;
    }
}

function absolutize(root: Element, base: string): void {
    for (const [selector, attribute] of [['a[href]', 'href'], ['img[src]', 'src']] as const) {
        for (const element of Array.from(root.querySelectorAll(selector))) {
            const url = absolute(element.getAttribute(attribute) ?? '', base);
            if (url) element.setAttribute(attribute, url);
            else element.removeAttribute(attribute);
        }
    }
}

const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
});

/** An HTML page as markdown, links and images absolute against `baseUrl`. */
export function htmlToMarkdown(html: string, baseUrl: string): ConvertedPage {
    const document = domino.createDocument(html);
    const title = titleOf(document);
    const root = readableRoot(document);
    absolutize(root, baseUrl);
    const content = turndown.turndown(root as unknown as TurndownService.Node).trim();
    return title === undefined ? { content } : { title, content };
}

function collectText(node: Node, out: string[]): void {
    if (node.nodeType === 3) {
        out.push(node.nodeValue ?? '');
        return;
    }
    if (node.nodeType !== 1) return;
    const block = BLOCK_ELEMENTS.has((node as Element).tagName);
    if (block) out.push('\n');
    for (const child of Array.from(node.childNodes)) collectText(child, out);
    if (block) out.push('\n');
}

/** An HTML page as plain text: one line per block, whitespace collapsed. */
export function htmlToText(html: string): ConvertedPage {
    const document = domino.createDocument(html);
    const title = titleOf(document);
    const parts: string[] = [];
    collectText(readableRoot(document), parts);
    const content = parts.join('')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line.length > 0)
        .join('\n');
    return title === undefined ? { content } : { title, content };
}
