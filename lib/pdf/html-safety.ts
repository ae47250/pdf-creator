import * as csstree from 'css-tree';
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { PdfServiceError } from './errors';
import { CSP, LIMITS } from './limits';
import type { PageSettings } from './types';

type Attribute = { name: string; value: string };
type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  value?: string;
  attrs?: Attribute[];
  childNodes?: HtmlNode[];
};

const FORBIDDEN_ELEMENTS = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'form',
  'input', 'button', 'select', 'textarea', 'video', 'audio', 'track', 'source'
]);
const RESOURCE_ATTRIBUTES = new Set(['src', 'srcset', 'poster', 'data', 'action', 'formaction']);
const DATA_IMAGE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/;
const DATA_FONT = /^data:font\/woff2;base64,([A-Za-z0-9+/]+={0,2})$/;

export interface SafeHtml {
  html: string;
  markerCount: number;
  imageCount: number;
  cssRuleCount: number;
  domElementCount: number;
}

export function validateAndNormalizeHtml(html: string, page: PageSettings): SafeHtml {
  if (!/^\s*<!doctype html>/i.test(html)) unsafe('A complete HTML document with a doctype is required.');
  if (!/<html(?:\s|>)/i.test(html) || !/<head(?:\s|>)/i.test(html) || !/<body(?:\s|>)/i.test(html)) {
    unsafe('The submitted source must explicitly contain html, head, and body elements.');
  }
  const document = parse(html) as HtmlNode;
  const htmlElement = findElement(document, 'html');
  const head = findElement(document, 'head');
  const body = findElement(document, 'body');
  if (!htmlElement || !head || !body) unsafe('The document must contain html, head, and body elements.');

  let domElementCount = 0;
  let imageCount = 0;
  let cssRuleCount = 0;
  let markerCount = 0;
  let hasRenderableContent = false;

  const visit = (node: HtmlNode, depth: number, insideMarker: boolean): void => {
    if (depth > LIMITS.domDepth) unsafe(`The DOM exceeds the maximum depth of ${LIMITS.domDepth}.`);
    const tag = node.tagName?.toLowerCase();
    let childInsideMarker = insideMarker;

    if (tag) {
      domElementCount += 1;
      if (domElementCount > LIMITS.domElements) unsafe(`The DOM exceeds ${LIMITS.domElements} elements.`);
      if (FORBIDDEN_ELEMENTS.has(tag)) unsafe(`The ${tag} element is not allowed.`);
      if (tag === 'link') unsafe('Link elements are not allowed; styles must be inline.');
      if (tag === 'meta') validateMeta(node.attrs ?? []);

      const attrs = new Map((node.attrs ?? []).map((attribute) => [attribute.name.toLowerCase(), attribute.value]));
      for (const [name, value] of attrs) {
        if (name.startsWith('on')) unsafe('Event-handler attributes are not allowed.');
        if (name === 'style') cssRuleCount += validateCss(value, 'declarationList');
        if (RESOURCE_ATTRIBUTES.has(name)) validateResourceAttribute(tag, name, value);
        if ((name === 'href' || name === 'xlink:href') && tag === 'a') validateAnchor(value);
        else if (name === 'href' || name === 'xlink:href') validateEmbeddedReference(value);
      }

      if (attrs.has('data-pdf-page')) {
        if (insideMarker) unsafe('data-pdf-page elements may not be nested.');
        markerCount += 1;
        if (markerCount > LIMITS.pages) unsafe(`No more than ${LIMITS.pages} page markers are allowed.`);
        childInsideMarker = true;
      }

      if (tag === 'img') {
        imageCount += 1;
        if (imageCount > LIMITS.images) unsafe(`No more than ${LIMITS.images} images are allowed.`);
        const source = attrs.get('src');
        if (!source) unsafe('Every image must have an embedded data URL.');
        validateImageData(source);
        hasRenderableContent = true;
      }
      if (tag === 'style') {
        const css = (node.childNodes ?? []).map((child) => child.value ?? '').join('');
        cssRuleCount += validateCss(css, 'stylesheet');
      }
      if (!['html', 'head', 'body', 'meta', 'style', 'title'].includes(tag)) hasRenderableContent = true;
    }

    for (const child of node.childNodes ?? []) {
      if (child.nodeName === '#text' && child.value?.trim() && !['head', 'style', 'title'].includes(tag ?? '')) {
        hasRenderableContent = true;
      }
      visit(child, tag ? depth + 1 : depth, childInsideMarker);
    }
  };
  visit(document, 0, false);

  if (cssRuleCount > LIMITS.cssRules) unsafe(`The document exceeds ${LIMITS.cssRules} CSS rules.`);
  if (!hasRenderableContent) unsafe('The document contains no renderable content.');

  head.childNodes ??= [];
  head.childNodes.push(makeElement('meta', [
    { name: 'http-equiv', value: 'Content-Security-Policy' },
    { name: 'content', value: CSP }
  ]));
  const finalPageRule = `@page{size:${page.format} ${page.orientation};margin:${page.marginsInches.top}in ${page.marginsInches.right}in ${page.marginsInches.bottom}in ${page.marginsInches.left}in}`;
  head.childNodes.push(makeElement('style', [], [{ nodeName: '#text', value: finalPageRule }]));

  return { html: serialize(document as unknown as DefaultTreeAdapterMap['parentNode']), markerCount, imageCount, cssRuleCount, domElementCount };
}

function validateMeta(attributes: Attribute[]): void {
  const attrs = new Map(attributes.map((attribute) => [attribute.name.toLowerCase(), attribute.value.toLowerCase()]));
  if (attrs.get('http-equiv') === 'refresh') unsafe('Meta refresh is not allowed.');
}

function validateAnchor(value: string): void {
  if (value.startsWith('#')) return;
  try {
    if (new URL(value).protocol === 'https:') return;
  } catch { /* controlled below */ }
  unsafe('Anchor links must use HTTPS or an internal fragment.');
}

function validateEmbeddedReference(value: string): void {
  if (value.startsWith('#')) return;
  if (DATA_IMAGE.test(value)) {
    validateImageData(value);
    return;
  }
  unsafe('Embedded references must use an allowed data URL or fragment.');
}

function validateResourceAttribute(tag: string, name: string, value: string): void {
  if (tag === 'img' && name === 'src') {
    validateImageData(value);
    return;
  }
  unsafe('External and relative resource URLs are not allowed.');
}

function validateImageData(value: string): void {
  const match = value.match(DATA_IMAGE);
  if (!match) unsafe('Images must be base64 PNG, JPEG, WebP, or SVG data URLs.');
  const [, type, encoded] = match;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(encoded, 'base64');
    if (bytes.length === 0 || bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new Error();
  } catch {
    unsafe('An image data URL is malformed.');
  }
  if (type === 'png' && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) unsafe('A PNG data URL has an invalid signature.');
  if (type === 'jpeg' && !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9)) unsafe('A JPEG data URL has an invalid signature.');
  if (type === 'webp' && !(bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')) unsafe('A WebP data URL has an invalid signature.');
  if (type === 'svg+xml') validateSvg(bytes.toString('utf8'));
}

function validateSvg(svg: string): void {
  if (!/^\s*<svg[\s>]/i.test(svg)) unsafe('An SVG data URL is malformed.');
  if (/<!doctype|<!entity/i.test(svg)) unsafe('SVG doctypes and entities are not allowed.');
  const document = parse(`<html><body>${svg}</body></html>`) as HtmlNode;
  const rejected = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed']);
  const walk = (node: HtmlNode): void => {
    const tag = node.tagName?.toLowerCase();
    if (tag && rejected.has(tag)) unsafe('SVG active content is not allowed.');
    for (const attribute of node.attrs ?? []) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) unsafe('SVG event handlers are not allowed.');
      if (name === 'href' || name === 'xlink:href') validateEmbeddedReference(attribute.value);
      if (name === 'style') validateCss(attribute.value, 'declarationList');
    }
    if (tag === 'style') validateCss((node.childNodes ?? []).map((child) => child.value ?? '').join(''), 'stylesheet');
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(document);
}

function validateCss(css: string, context: 'stylesheet' | 'declarationList'): number {
  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(css, { context, parseValue: true, parseCustomProperty: true });
  } catch {
    unsafe('The document contains malformed CSS.');
  }
  let rules = 0;
  csstree.walk(ast!, (node) => {
    if (node.type === 'Rule') rules += 1;
    if (node.type === 'Atrule' && node.name.toLowerCase() === 'import') unsafe('CSS @import is not allowed.');
    if (node.type === 'Url') {
      const value = node.value.trim();
      if (DATA_FONT.test(value)) {
        validateFontData(value);
        return;
      }
      if (DATA_IMAGE.test(value)) {
        validateImageData(value);
        return;
      }
      unsafe('CSS URLs must contain embedded WOFF2 fonts or supported images.');
    }
  });
  return rules;
}

function validateFontData(value: string): void {
  const match = value.match(DATA_FONT);
  if (!match) unsafe('Fonts must be base64 WOFF2 data URLs.');
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[1], 'base64');
    if (bytes.toString('base64').replace(/=+$/, '') !== match[1].replace(/=+$/, '')) throw new Error();
  } catch {
    unsafe('A font data URL is malformed.');
  }
  if (bytes.length < 48 || bytes.subarray(0, 4).toString('ascii') !== 'wOF2') {
    unsafe('A WOFF2 data URL has an invalid signature.');
  }
}

function findElement(node: HtmlNode, tagName: string): HtmlNode | undefined {
  if (node.tagName?.toLowerCase() === tagName) return node;
  for (const child of node.childNodes ?? []) {
    const found = findElement(child, tagName);
    if (found) return found;
  }
  return undefined;
}

function makeElement(tagName: string, attrs: Attribute[], childNodes: HtmlNode[] = []): HtmlNode {
  return {
    nodeName: tagName,
    tagName,
    attrs,
    childNodes,
    namespaceURI: 'http://www.w3.org/1999/xhtml'
  } as HtmlNode;
}

function unsafe(message: string): never {
  throw new PdfServiceError('unsafe_html', 400, message);
}
