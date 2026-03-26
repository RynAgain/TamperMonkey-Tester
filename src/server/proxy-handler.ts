/**
 * HTTP Proxy Handler with HTML Rewriting
 *
 * Fetches a target URL via undici, strips security headers that would
 * block script injection, rewrites relative URLs to absolute, and
 * provides a helper to inject script tags into HTML at the correct positions.
 */

import { request } from 'undici';
import * as htmlparser2 from 'htmlparser2';
import { DomHandler, Element, Text } from 'domhandler';
import domSerializer from 'dom-serializer';
import { findAll } from 'domutils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  contentType: string;
}

// ---------------------------------------------------------------------------
// Security headers to strip from proxied responses
// ---------------------------------------------------------------------------

const STRIPPED_HEADERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'x-content-type-options',
]);

// ---------------------------------------------------------------------------
// proxyRequest
// ---------------------------------------------------------------------------

/**
 * Fetches a target URL and returns the response.
 * For HTML responses, strips CSP headers and rewrites relative URLs
 * so that resources resolve correctly when served through the proxy.
 *
 * @param targetUrl - The fully-qualified URL to fetch.
 * @returns A {@link ProxyResult} with status, cleaned headers, body, and content type.
 */
export async function proxyRequest(targetUrl: string): Promise<ProxyResult> {
  try {
    const { statusCode, headers: rawHeaders, body: responseBody } = await request(targetUrl);

    // Collect the full response body as a string
    const chunks: Buffer[] = [];
    for await (const chunk of responseBody) {
      chunks.push(Buffer.from(chunk));
    }
    let body = Buffer.concat(chunks).toString('utf-8');

    // Build a clean headers map, stripping security headers.
    // rawHeaders is IncomingHttpHeaders (Record<string, string | string[] | undefined>).
    const headers: Record<string, string> = {};

    for (const [key, value] of Object.entries(rawHeaders)) {
      if (STRIPPED_HEADERS.has(key.toLowerCase())) {
        continue;
      }
      // Flatten array header values into comma-separated strings
      if (Array.isArray(value)) {
        headers[key.toLowerCase()] = value.join(', ');
      } else if (value !== undefined) {
        headers[key.toLowerCase()] = String(value);
      }
    }

    // Determine content type
    const contentType = headers['content-type'] ?? 'application/octet-stream';
    const isHtml = contentType.toLowerCase().includes('text/html');

    // For HTML responses, rewrite relative URLs to absolute
    if (isHtml) {
      body = rewriteRelativeUrls(body, targetUrl);
      // Remove content-length since body length may have changed
      delete headers['content-length'];
      // Remove transfer-encoding since we're sending the full body
      delete headers['transfer-encoding'];
    }

    // Add CORS headers so the proxy works from any origin
    headers['access-control-allow-origin'] = '*';
    headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['access-control-allow-headers'] = '*';

    return { statusCode, headers, body, contentType };
  } catch (err) {
    // Return a 502 Bad Gateway on fetch failure
    const message = err instanceof Error ? err.message : String(err);
    return {
      statusCode: 502,
      headers: { 'content-type': 'text/plain' },
      body: `Proxy error: ${message}`,
      contentType: 'text/plain',
    };
  }
}

// ---------------------------------------------------------------------------
// injectScriptsIntoHtml
// ---------------------------------------------------------------------------

/**
 * Injects script tags into an HTML body string at the appropriate positions.
 *
 * @param html        - The HTML string to modify.
 * @param headScripts - Script content strings to inject right after `<head>` (for document-start).
 * @param bodyScripts - Script content strings to inject right before `</body>` (for document-end/idle).
 * @returns The modified HTML string with injected scripts.
 */
export function injectScriptsIntoHtml(
  html: string,
  headScripts: string[],
  bodyScripts: string[],
): string {
  // Nothing to inject
  if (headScripts.length === 0 && bodyScripts.length === 0) {
    return html;
  }

  // Parse the HTML into a DOM
  const handler = new DomHandler();
  const parser = new htmlparser2.Parser(handler);
  parser.write(html);
  parser.end();

  const dom = handler.dom;

  // Build script elements for head injection
  const headElements = headScripts.map((content) => {
    const textNode = new Text(content);
    const scriptEl = new Element('script', { type: 'text/javascript' }, [textNode]);
    textNode.parent = scriptEl;
    return scriptEl;
  });

  // Build script elements for body injection
  const bodyElements = bodyScripts.map((content) => {
    const textNode = new Text(content);
    const scriptEl = new Element('script', { type: 'text/javascript' }, [textNode]);
    textNode.parent = scriptEl;
    return scriptEl;
  });

  // Find <head> and <body> elements
  const headEl = findFirst(dom, 'head');
  const bodyEl = findFirst(dom, 'body');

  // Inject head scripts right after <head> opening
  if (headElements.length > 0) {
    if (headEl) {
      // Prepend to head's children
      for (let i = headElements.length - 1; i >= 0; i--) {
        const el = headElements[i];
        el.parent = headEl;
        headEl.children.unshift(el);
      }
      // Fix sibling links
      fixSiblingLinks(headEl.children);
    } else {
      // No <head> found -- prepend to document root
      for (let i = headElements.length - 1; i >= 0; i--) {
        dom.unshift(headElements[i]);
      }
    }
  }

  // Inject body scripts right before </body> closing
  if (bodyElements.length > 0) {
    if (bodyEl) {
      // Append to body's children (before closing tag)
      for (const el of bodyElements) {
        el.parent = bodyEl;
        bodyEl.children.push(el);
      }
      // Fix sibling links
      fixSiblingLinks(bodyEl.children);
    } else {
      // No <body> found -- append to document root
      for (const el of bodyElements) {
        dom.push(el);
      }
    }
  }

  return domSerializer(dom, { decodeEntities: false });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Rewrite relative URLs in `href`, `src`, and `action` attributes to
 * absolute URLs based on the target page's origin.
 */
function rewriteRelativeUrls(html: string, targetUrl: string): string {
  let origin: string;
  let basePath: string;

  try {
    const parsed = new URL(targetUrl);
    origin = parsed.origin;
    // Base path for resolving relative paths (directory of the page)
    basePath = parsed.pathname.replace(/\/[^/]*$/, '/');
  } catch {
    // If the target URL is unparseable, return HTML unchanged
    return html;
  }

  const handler = new DomHandler();
  const parser = new htmlparser2.Parser(handler);
  parser.write(html);
  parser.end();

  const dom = handler.dom;

  // Find all elements that may contain URL attributes
  const urlAttrs = ['href', 'src', 'action'];
  const allElements = findAll(
    (node): node is Element => node instanceof Element,
    dom,
  );

  for (const el of allElements) {
    for (const attr of urlAttrs) {
      const value = el.attribs[attr];
      if (!value) continue;

      // Skip data URIs, javascript:, anchors, protocol-relative, and absolute URLs
      if (
        value.startsWith('data:') ||
        value.startsWith('javascript:') ||
        value.startsWith('#') ||
        value.startsWith('//') ||
        /^https?:\/\//i.test(value) ||
        value.startsWith('blob:') ||
        value.startsWith('mailto:')
      ) {
        continue;
      }

      // Resolve the relative URL to an absolute one
      if (value.startsWith('/')) {
        // Root-relative
        el.attribs[attr] = origin + value;
      } else {
        // Path-relative
        el.attribs[attr] = origin + basePath + value;
      }
    }
  }

  return domSerializer(dom, { decodeEntities: false });
}

/**
 * Find the first element with the given tag name in a DOM tree.
 */
function findFirst(
  nodes: ArrayLike<import('domhandler').ChildNode>,
  tagName: string,
): Element | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node instanceof Element && node.tagName === tagName) {
      return node;
    }
    if (node instanceof Element && node.children.length > 0) {
      const found = findFirst(node.children, tagName);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Fix prev/next sibling links after inserting elements into a children array.
 */
function fixSiblingLinks(children: import('domhandler').ChildNode[]): void {
  for (let i = 0; i < children.length; i++) {
    children[i].prev = children[i - 1] ?? null;
    children[i].next = children[i + 1] ?? null;
  }
}
