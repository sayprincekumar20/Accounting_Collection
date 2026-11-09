import { ElementType, parseDocument } from "htmlparser2";

const allowedTags = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "del",
  "mark",
  "span",
  "div",
  "ul",
  "ol",
  "li",
]);
const voidTags = new Set(["br"]);
const discardContentTags = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "template",
  "svg",
  "math",
]);

export function sanitizeReplyHtml(html: string) {
  const document = parseDocument(html, {
    decodeEntities: true,
    lowerCaseTags: true,
    lowerCaseAttributeNames: true,
  });

  function serialize(nodes: typeof document.children, discardContent = false): string {
    return nodes
      .map((node) => {
        if (node.type === ElementType.Text) {
          return discardContent ? "" : escapeHtml(node.data);
        }
        if (!("children" in node) || !("name" in node)) return "";

        const tag = node.name;
        const discardChildren = discardContent || discardContentTags.has(tag);
        const content = serialize(node.children, discardChildren);
        if (discardContent || discardContentTags.has(tag)) return "";
        if (!allowedTags.has(tag)) return content;

        const style = tag === "span" ? safeHighlightStyle(node.attribs["style"]) : "";
        const attributes = style ? ` style="${escapeHtmlAttribute(style)}"` : "";
        if (voidTags.has(tag)) return `<${tag}${attributes}>`;
        return `<${tag}${attributes}>${content}</${tag}>`;
      })
      .join("");
  }

  return serialize(document.children);
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function safeHighlightStyle(style: string | undefined) {
  if (!style) return "";
  const match =
    /^\s*background-color\s*:\s*(#[\da-f]{3,8}|yellow|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\))\s*;?\s*$/i.exec(
      style,
    );
  return match ? `background-color:${match[1]}` : "";
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

export function replyHtmlToText(html: string) {
  const safe = sanitizeReplyHtml(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "");
  return decodeHtmlEntities(safe)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function replyHtmlToWhatsAppText(html: string) {
  const safe = sanitizeReplyHtml(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<(strong|b)>/gi, "*")
    .replace(/<\/(strong|b)>/gi, "*")
    .replace(/<(em|i)>/gi, "_")
    .replace(/<\/(em|i)>/gi, "_")
    .replace(/<(s|strike|del)>/gi, "~")
    .replace(/<\/(s|strike|del)>/gi, "~")
    .replace(/<[^>]*>/g, "");
  return decodeHtmlEntities(safe)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
