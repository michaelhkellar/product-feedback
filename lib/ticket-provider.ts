import { TicketProviderType, DocProviderType } from "./api-keys";

export interface CreateTicketResult {
  id: string;
  key: string;
  url: string;
}

// Jira wiki markup injection patterns to strip
const JIRA_INJECTION_PATTERNS = [
  /\{code[^}]*\}/gi,
  /\{panel[^}]*\}/gi,
  /\{noformat\}/gi,
  /\{color[^}]*\}/gi,
  /\[~[^\]]+\]/g,        // @-mention syntax
  /\{jiraissues[^}]*\}/gi,
];

// Linear markdown is standard — just strip HTML
const HTML_TAG_PATTERN = /<\/?[^>]+(>|$)/g;

// Only allow safe URL schemes in markdown links/images
const ALLOWED_URL_SCHEME = /^(https?:|mailto:|tel:|\/|#)/i;

export function sanitizeForProvider(content: string, provider: TicketProviderType | DocProviderType): string {
  let sanitized = content;

  // Rewrite disallowed URL schemes in markdown links and images to "#"
  sanitized = sanitized.replace(
    /(!?)\[([^\]]*)\]\(([^)]+)\)/g,
    (_m, bang, text, url) => {
      const trimmed = url.trim();
      return ALLOWED_URL_SCHEME.test(trimmed) ? `${bang}[${text}](${trimmed})` : `${bang}[${text}](#)`;
    }
  );

  // Strip any embedded HTML tags
  sanitized = sanitized.replace(HTML_TAG_PATTERN, "");

  if (provider === "atlassian") {
    for (const pattern of JIRA_INJECTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, "");
    }
  }

  // Trim excessive whitespace
  sanitized = sanitized.replace(/\n{3,}/g, "\n\n").trim();

  return sanitized;
}

export function markdownToADF(markdown: string): Record<string, unknown> {
  const lines = markdown.split("\n");
  const content: Record<string, unknown>[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("## ")) {
      content.push({
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: trimmed.slice(3) }],
      });
    } else if (trimmed.startsWith("# ")) {
      content.push({
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: trimmed.slice(2) }],
      });
    } else if (trimmed.startsWith("- [ ] ")) {
      content.push({
        type: "taskList",
        attrs: { localId: "" },
        content: [{
          type: "taskItem",
          attrs: { localId: "", state: "TODO" },
          content: [{ type: "text", text: trimmed.slice(6) }],
        }],
      });
    } else if (trimmed.startsWith("- ")) {
      content.push({
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: trimmed.slice(2) }],
          }],
        }],
      });
    } else {
      content.push({
        type: "paragraph",
        content: [{ type: "text", text: trimmed }],
      });
    }
  }

  return { version: 1, type: "doc", content };
}
