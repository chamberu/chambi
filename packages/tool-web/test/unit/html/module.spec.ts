/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    decodeBody,
    htmlToMarkdown,
    htmlToText,
    isHtml,
    isText,
} from '../../../src/html/module.ts';

const SCRIPT_URL = ['javascript', 'alert(1)'].join(':');

const PAGE = `<!doctype html>
<html>
<head><title>Release notes &amp; more</title><style>body { color: red }</style></head>
<body>
<nav><a href="/">Home</a> <a href="/blog">Blog</a></nav>
<main>
<h1>v2.0.0</h1>
<p>Breaking: <a href="../migrate">read the guide</a>, see <img src="img/chart.png" alt="chart">.</p>
<script>window.evil = true;</script>
<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>
<ul><li>one</li><li>two</li></ul>
</main>
<footer>Copyright</footer>
</body>
</html>`;

describe('htmlToMarkdown', () => {
    it('turns the main content into markdown', () => {
        const { title, content } = htmlToMarkdown(PAGE, 'https://example.com/docs/notes/');

        expect(title).toBe('Release notes & more');
        expect(content).toContain('# v2.0.0');
        expect(content).toContain('[read the guide](https://example.com/docs/migrate)');
        expect(content).toContain('![chart](https://example.com/docs/notes/img/chart.png)');
        expect(content).toContain('```ts\nconst a = 1 < 2;\n```');
        expect(content).toMatch(/-\s+one/);
    });

    it('drops scripts, styles, navigation and footers', () => {
        const { content } = htmlToMarkdown(PAGE, 'https://example.com/');

        expect(content).not.toContain('evil');
        expect(content).not.toContain('color: red');
        expect(content).not.toContain('Blog');
        expect(content).not.toContain('Copyright');
    });

    it('takes the body without a main element, and one article when there is one', () => {
        expect(htmlToMarkdown('<body><p>plain</p></body>', 'https://example.com/').content).toBe('plain');
        expect(htmlToMarkdown('<body><nav>menu</nav><article><p>story</p></article></body>', 'https://example.com/').content).toBe('story');
        expect(htmlToMarkdown('<body><article>a</article><article>b</article></body>', 'https://example.com/').content).toBe('a\n\nb');
    });

    it('keeps links it cannot resolve and drops script links', () => {
        const { content } = htmlToMarkdown(`<p><a href="${SCRIPT_URL}">x</a> <a href="mailto:a@b.c">mail</a></p>`, 'https://example.com/');

        expect(content).not.toContain(SCRIPT_URL);
        expect(content).toContain('x');
        expect(content).toContain('[mail](mailto:a@b.c)');
    });

    it('has no title for a page without one', () => {
        expect(htmlToMarkdown('<p>x</p>', 'https://example.com/').title).toBeUndefined();
    });
});

describe('htmlToText', () => {
    it('keeps block breaks, image alt text and list items, and collapses whitespace', () => {
        const { title, content } = htmlToText(PAGE, 'https://example.com/docs');

        expect(title).toBe('Release notes & more');
        expect(content).toBe('v2.0.0\n\nBreaking: read the guide, see chart.\n\nconst a = 1 < 2;\n\none\ntwo');
    });
});

describe('decodeBody', () => {
    it('decodes by the charset of the content type', () => {
        expect(decodeBody(new Uint8Array([0x63, 0x61, 0x66, 0xE9]), 'text/html; charset=windows-1252')).toBe('café');
        expect(decodeBody(new TextEncoder().encode('café'), 'text/plain')).toBe('café');
    });

    it('reads a meta charset of an html page without one in the header', () => {
        const bytes = new Uint8Array([...new TextEncoder().encode('<meta charset="iso-8859-1"><p>'), 0xE9]);
        expect(decodeBody(bytes, 'text/html')).toBe('<meta charset="iso-8859-1"><p>é');
    });

    it('falls back to utf-8 for an unknown charset', () => {
        expect(decodeBody(new TextEncoder().encode('ok'), 'text/plain; charset=nonsense')).toBe('ok');
    });
});

describe('media types', () => {
    it('tells html and text apart', () => {
        expect(isHtml('text/html; charset=utf-8')).toBe(true);
        expect(isHtml('application/xhtml+xml')).toBe(true);
        expect(isHtml('text/plain')).toBe(false);
        expect(isText('text/markdown')).toBe(true);
        expect(isText('application/json')).toBe(true);
        expect(isText('application/vnd.github+json')).toBe(true);
        expect(isText('application/atom+xml')).toBe(true);
        expect(isText('application/javascript')).toBe(true);
        expect(isText('image/png')).toBe(false);
        expect(isText('application/pdf')).toBe(false);
        expect(isText(null)).toBe(true);
    });
});
