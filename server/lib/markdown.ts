import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

const marked = new Marked({ gfm: true, breaks: false });

// Callout syntax: > [!TIP] / > [!NOTE] / > [!WARNING]
function callouts(html: string) {
  return html.replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*/g,
    (_m, kind: string) => `<blockquote class="callout callout-${kind.toLowerCase()}"><p>`,
  );
}

function slugifyHeading(text: string) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

function headingAnchors(html: string) {
  return html.replace(/<h([23])>(.*?)<\/h\1>/g, (_m, lvl: string, inner: string) => `<h${lvl} id="${slugifyHeading(inner)}">${inner}</h${lvl}>`);
}

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "p", "a", "ul", "ol", "li", "strong", "em", "del", "code", "pre", "blockquote",
    "img", "table", "thead", "tbody", "tr", "th", "td", "hr", "br", "kbd", "details", "summary", "span", "input",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    h2: ["id"],
    h3: ["id"],
    blockquote: ["class"],
    code: ["class"],
    span: ["class"],
    input: ["type", "checked", "disabled"],
    th: ["align"],
    td: ["align"],
  },
  allowedSchemes: ["https", "http", "mailto"],
  allowedSchemesByTag: { img: ["https", "http", "data"] },
  allowedClasses: { blockquote: ["callout", "callout-note", "callout-tip", "callout-warning", "callout-important"], code: [/^language-/] },
  transformTags: {
    a: (tagName, attribs) => {
      const external = /^https?:\/\//.test(attribs.href ?? "");
      return { tagName, attribs: external ? { ...attribs, target: "_blank", rel: "noopener noreferrer" } : attribs };
    },
    img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: "lazy" } }),
    input: (tagName, attribs) => ({ tagName, attribs: { ...attribs, disabled: "disabled" } }),
  },
};

export function renderMarkdown(md: string): string {
  const raw = marked.parse(md ?? "", { async: false }) as string;
  return sanitizeHtml(headingAnchors(callouts(raw)), SANITIZE);
}

export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
