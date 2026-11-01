// Minimal, strict XML/SVG reader for model-authored view markup. It has no DOM dependency so
// the validator, static renderer and tests run in Node. It deliberately rejects DOCTYPE,
// processing instructions other than the XML prolog, and named entities beyond XML's five.

export interface SvgElement {
  type: "element";
  name: string;
  attrs: Record<string, string>;
  children: SvgNode[];
}
export interface SvgText { type: "text"; text: string; cdata: boolean }
export type SvgNode = SvgElement | SvgText;

export class SvgParseError extends Error {
  constructor(message: string) { super(message); this.name = "SvgParseError"; }
}

const NAME = /[A-Za-z_][\w.:-]*/y;
const SPACE = /\s*/y;

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos|[A-Za-z][\w]*);/g, (_, body: string) => {
    if (body === "amp") return "&";
    if (body === "lt") return "<";
    if (body === "gt") return ">";
    if (body === "quot") return "\"";
    if (body === "apos") return "'";
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    throw new SvgParseError(`Unsupported entity &${body};`);
  });
}

export function parseSvg(source: string): SvgElement {
  let i = 0;
  const at = (s: string) => source.startsWith(s, i);
  const skipSpace = () => { SPACE.lastIndex = i; SPACE.exec(source); i = SPACE.lastIndex; };
  const readName = (): string => {
    NAME.lastIndex = i;
    const m = NAME.exec(source);
    if (!m) throw new SvgParseError(`Expected a name at offset ${i}`);
    i = NAME.lastIndex;
    return m[0];
  };
  const skipMisc = () => {
    for (;;) {
      skipSpace();
      if (at("<!--")) {
        const end = source.indexOf("-->", i + 4);
        if (end < 0) throw new SvgParseError("Unterminated comment");
        i = end + 3;
      } else if (at("<?xml")) {
        if (i !== 0 && source.slice(0, i).trim() !== "") throw new SvgParseError("XML declaration must be first");
        const end = source.indexOf("?>", i);
        if (end < 0) throw new SvgParseError("Unterminated XML declaration");
        i = end + 2;
      } else if (at("<?")) throw new SvgParseError("Processing instructions are not allowed");
      else if (at("<!DOCTYPE") || at("<!doctype")) throw new SvgParseError("DOCTYPE is not allowed");
      else return;
    }
  };

  const readElement = (depth: number): SvgElement => {
    if (depth > 64) throw new SvgParseError("Element nesting too deep");
    if (!at("<")) throw new SvgParseError(`Expected '<' at offset ${i}`);
    i += 1;
    const name = readName();
    const attrs: Record<string, string> = {};
    for (;;) {
      skipSpace();
      if (at("/>")) { i += 2; return { type: "element", name, attrs, children: [] }; }
      if (at(">")) { i += 1; break; }
      const attr = readName();
      skipSpace();
      if (!at("=")) throw new SvgParseError(`Attribute ${attr} on <${name}> has no value`);
      i += 1;
      skipSpace();
      const quote = source[i];
      if (quote !== "\"" && quote !== "'") throw new SvgParseError(`Attribute ${attr} on <${name}> is not quoted`);
      const end = source.indexOf(quote, i + 1);
      if (end < 0) throw new SvgParseError(`Unterminated attribute ${attr}`);
      const raw = source.slice(i + 1, end);
      if (raw.includes("<")) throw new SvgParseError(`Attribute ${attr} contains '<'`);
      if (Object.hasOwn(attrs, attr)) throw new SvgParseError(`Duplicate attribute ${attr} on <${name}>`);
      attrs[attr] = decodeEntities(raw);
      i = end + 1;
    }
    const children: SvgNode[] = [];
    for (;;) {
      if (i >= source.length) throw new SvgParseError(`Unclosed <${name}>`);
      if (at("</")) {
        i += 2;
        const close = readName();
        if (close !== name) throw new SvgParseError(`Mismatched </${close}> for <${name}>`);
        skipSpace();
        if (!at(">")) throw new SvgParseError(`Malformed </${close}>`);
        i += 1;
        return { type: "element", name, attrs, children };
      }
      if (at("<!--")) {
        const end = source.indexOf("-->", i + 4);
        if (end < 0) throw new SvgParseError("Unterminated comment");
        i = end + 3;
        continue;
      }
      if (at("<![CDATA[")) {
        const end = source.indexOf("]]>", i);
        if (end < 0) throw new SvgParseError("Unterminated CDATA");
        children.push({ type: "text", text: source.slice(i + 9, end), cdata: true });
        i = end + 3;
        continue;
      }
      if (at("<!") || at("<?")) throw new SvgParseError("Markup declarations are not allowed inside elements");
      if (at("<")) { children.push(readElement(depth + 1)); continue; }
      const next = source.indexOf("<", i);
      const end = next < 0 ? source.length : next;
      children.push({ type: "text", text: decodeEntities(source.slice(i, end)), cdata: false });
      i = end;
    }
  };

  skipMisc();
  const root = readElement(0);
  skipMisc();
  if (i !== source.length) throw new SvgParseError("Content after the root element");
  return root;
}

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

export function serializeSvg(node: SvgNode): string {
  if (node.type === "text") return node.cdata ? `<![CDATA[${node.text.replace(/]]>/g, "]]]]><![CDATA[>")}]]>` : escapeText(node.text);
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
  if (node.children.length === 0) return `<${node.name}${attrs}/>`;
  return `<${node.name}${attrs}>${node.children.map(serializeSvg).join("")}</${node.name}>`;
}

export function* walk(node: SvgElement, ancestors: SvgElement[] = []): Generator<{ el: SvgElement; ancestors: SvgElement[] }> {
  yield { el: node, ancestors };
  for (const child of node.children) if (child.type === "element") yield* walk(child, [...ancestors, node]);
}

export function textContent(node: SvgNode): string {
  return node.type === "text" ? node.text : node.children.map(textContent).join("");
}

export function cloneElement(node: SvgElement): SvgElement {
  return structuredClone(node);
}

export function indexById(root: SvgElement): Map<string, SvgElement> {
  const map = new Map<string, SvgElement>();
  for (const { el } of walk(root)) if (el.attrs.id !== undefined) map.set(el.attrs.id, el);
  return map;
}

// ---------------------------------------------------------------------------------------------
// Safety policy for model-authored markup. The browser host adds a CSP and sandbox as well;
// this static gate rejects anything that could script, fetch, animate independently, or
// override the host's trusted health styling.

export const allowedElements = new Set([
  "svg", "g", "defs", "style", "title", "desc", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "path", "text", "tspan", "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "marker", "symbol", "use"
]);

const forbiddenAttribute = /^(on|xml:base$|attributeName$|begin$|dur$|repeatCount$|xlink:actuate$|xlink:show$)/i;
const externalRef = /(javascript:|vbscript:|data:|https?:|ftp:|file:|\/\/)/i;
const nonFragmentUrl = /url\(\s*(?!['"]?#)/i;

export function inspectCss(css: string): string[] {
  const issues: string[] = [];
  if (/@import/i.test(css)) issues.push("CSS @import is not allowed");
  if (/@font-face/i.test(css)) issues.push("CSS @font-face is not allowed");
  if (/@keyframes|\banimation(-[a-z]+)?\s*:/i.test(css)) issues.push("CSS animation is not allowed: motion must come from snapshots");
  if (/\btransition(-[a-z]+)?\s*:/i.test(css)) issues.push("CSS transitions are not allowed: values must not interpolate independently of snapshots");
  if (/!important/i.test(css)) issues.push("!important is reserved for host health styling");
  if (nonFragmentUrl.test(css)) issues.push("CSS url() may only reference in-document fragments");
  if (externalRef.test(css)) issues.push("CSS contains an external or scriptable reference");
  if (/expression\s*\(|behavior\s*:|-moz-binding/i.test(css)) issues.push("Legacy scriptable CSS is not allowed");
  if (/(^|[\s,}>+~])(html|body|:root|iframe|div)\b/i.test(css) || /(^|[\s,}])\*(?=[\s,{])/.test(css)) issues.push("CSS may not target document-level selectors (html, body, :root, div, *)");
  if (/\bcb-[a-z]/i.test(css.replace(/data-cb-[a-z-]+/gi, ""))) issues.push("CSS may not target reserved host identifiers (cb-*)");
  return issues;
}

export interface SvgInspection {
  root: SvgElement;
  ids: Map<string, SvgElement>;
  issues: string[];
  elementCount: number;
  viewBox: { x: number; y: number; width: number; height: number } | null;
  equipmentRefs: Set<string>;
  css: string;
}

export function inspectSvg(source: string, limits = { maxBytes: 262_144, maxElements: 4000 }): SvgInspection | { error: string } {
  if (new TextEncoder().encode(source).length > limits.maxBytes) return { error: `SVG exceeds ${limits.maxBytes} bytes` };
  let root: SvgElement;
  try { root = parseSvg(source); } catch (error) { return { error: `SVG is not well-formed: ${(error as Error).message}` }; }
  const issues: string[] = [];
  if (root.name !== "svg") issues.push(`Root element is <${root.name}>, expected <svg>`);
  if (root.attrs.xmlns !== undefined && root.attrs.xmlns !== "http://www.w3.org/2000/svg") issues.push("Root xmlns must be the SVG namespace");
  const viewBoxParts = (root.attrs.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  const viewBox = viewBoxParts.length === 4 && viewBoxParts.every(Number.isFinite) && viewBoxParts[2]! > 0 && viewBoxParts[3]! > 0
    ? { x: viewBoxParts[0]!, y: viewBoxParts[1]!, width: viewBoxParts[2]!, height: viewBoxParts[3]! } : null;
  if (!viewBox) issues.push("Root <svg> needs a numeric viewBox");
  const ids = new Map<string, SvgElement>();
  const equipmentRefs = new Set<string>();
  let css = "";
  let elementCount = 0;
  for (const { el } of walk(root)) {
    elementCount += 1;
    if (!allowedElements.has(el.name)) issues.push(`Element <${el.name}> is not allowed`);
    for (const [name, value] of Object.entries(el.attrs)) {
      if (forbiddenAttribute.test(name)) issues.push(`Attribute ${name} on <${el.name}> is not allowed`);
      if (name.startsWith("xmlns:") && !["xmlns:xlink"].includes(name)) issues.push(`Namespace ${name} is not allowed`);
      if (name === "href" || name === "xlink:href") {
        if (el.name !== "use" || !/^#[A-Za-z_][\w.-]*$/.test(value)) issues.push(`${name} on <${el.name}> must be an in-document #fragment on <use>`);
      } else if (name !== "xmlns" && name !== "xmlns:xlink" && externalRef.test(value)) issues.push(`Attribute ${name} on <${el.name}> contains an external or scriptable reference`);
      if (nonFragmentUrl.test(value)) issues.push(`Attribute ${name} on <${el.name}> uses a non-fragment url()`);
      if (name === "style") for (const issue of inspectCss(value)) issues.push(`style on <${el.name}>: ${issue}`);
      if ((reservedSet.has(name)) && name !== "data-cb-template") issues.push(`Attribute ${name} is reserved for the host runtime`);
      if (name.startsWith("data-cb-") && !reservedSet.has(name) && !["data-cb-equipment", "data-cb-field"].includes(name)) issues.push(`Unknown host attribute ${name}`);
    }
    if (el.attrs.id !== undefined) {
      if (!/^[A-Za-z_][\w.-]{0,79}$/.test(el.attrs.id)) issues.push(`Invalid id "${el.attrs.id}"`);
      if (/^cb-/i.test(el.attrs.id)) issues.push(`id "${el.attrs.id}" uses the reserved cb- prefix`);
      if (ids.has(el.attrs.id)) issues.push(`Duplicate id "${el.attrs.id}"`);
      ids.set(el.attrs.id, el);
    }
    if (el.attrs["data-cb-equipment"] !== undefined) equipmentRefs.add(el.attrs["data-cb-equipment"]);
    if (el.name === "style") {
      const text = el.children.map(textContent).join("");
      css += `${text}\n`;
      for (const child of el.children) if (child.type === "element") issues.push("<style> may contain text only");
      for (const issue of inspectCss(text)) issues.push(`<style>: ${issue}`);
    } else {
      for (const child of el.children) if (child.type === "text" && child.cdata) issues.push(`CDATA is only allowed in <style> (found in <${el.name}>)`);
    }
  }
  if (elementCount > limits.maxElements) issues.push(`SVG has ${elementCount} elements; limit ${limits.maxElements}`);
  return { root, ids, issues, elementCount, viewBox, equipmentRefs, css };
}

const reservedSet = new Set<string>([
  "data-cb-value", "data-cb-health", "data-cb-source", "data-cb-selected", "data-cb-clone", "data-cb-entity",
  "data-cb-path", "data-cb-route", "data-cb-jammed", "data-cb-outside", "data-cb-template"
]);

/** Patterns that must never appear anywhere in a view package. */
export const credentialPattern = /(opc\.tcp:\/\/|\bpassword\b|\bpasswd\b|\bsecret\b|api[_-]?key|\bbearer\s|MODEL_API_KEY|\bns=\d+;[isgb]=|\bsk-[A-Za-z0-9]{12,})/i;
