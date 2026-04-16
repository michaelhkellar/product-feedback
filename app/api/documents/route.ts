import { NextRequest, NextResponse } from "next/server";
import { createConfluencePage } from "@/lib/atlassian";
import { sanitizeForProvider } from "@/lib/ticket-provider";

const COOLDOWN_MS = 10_000;
const lastCreation = new Map<string, number>();

function getRateLimitKey(req: NextRequest): string {
  return req.headers.get("x-forwarded-for") || req.ip || "unknown";
}

function markdownToConfluenceStorage(markdown: string): string {
  let html = markdown;

  // Headers
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Bullet lists (simple single-level)
  html = html.replace(
    /(^- .+$(\n- .+$)*)/gm,
    (match) => {
      const items = match
        .split("\n")
        .map((line) => `<li>${line.replace(/^- /, "")}</li>`)
        .join("");
      return `<ul>${items}</ul>`;
    }
  );

  // Checkboxes
  html = html.replace(/- \[ \] (.+)/g, '<ac:task-list><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>$1</ac:task-body></ac:task></ac:task-list>');
  html = html.replace(/- \[x\] (.+)/g, '<ac:task-list><ac:task><ac:task-status>complete</ac:task-status><ac:task-body>$1</ac:task-body></ac:task></ac:task-list>');

  // Tables
  html = html.replace(
    /(\|.+\|(\n\|.+\|)+)/g,
    (match) => {
      const rows = match.trim().split("\n").filter((row) => !row.match(/^\|\s*---/));
      if (rows.length === 0) return match;
      const headerCells = rows[0].split("|").filter(Boolean).map((c) => `<th>${c.trim()}</th>`).join("");
      const bodyRows = rows.slice(1).map((row) => {
        const cells = row.split("|").filter(Boolean).map((c) => `<td>${c.trim()}</td>`).join("");
        return `<tr>${cells}</tr>`;
      }).join("");
      return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    }
  );

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, "<blockquote><p>$1</p></blockquote>");

  // Paragraphs (lines that aren't already wrapped)
  const lines = html.split("\n");
  const result = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("<")) return trimmed;
    return `<p>${trimmed}</p>`;
  });

  return result.filter(Boolean).join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const clientKey = getRateLimitKey(req);
    const now = Date.now();
    const lastTime = lastCreation.get(clientKey) || 0;
    if (now - lastTime < COOLDOWN_MS) {
      return NextResponse.json(
        { error: "Rate limit: please wait before creating another document" },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { title, spaceId, content } = body;

    if (!title || typeof title !== "string") {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!spaceId || typeof spaceId !== "string") {
      return NextResponse.json({ error: "Space ID is required" }, { status: 400 });
    }

    const domain = req.headers.get("x-atlassian-domain") || undefined;
    const email = req.headers.get("x-atlassian-email") || undefined;
    const token = req.headers.get("x-atlassian-token") || undefined;

    if (!domain && !process.env.ATLASSIAN_DOMAIN) {
      return NextResponse.json({ error: "Atlassian credentials not configured" }, { status: 400 });
    }

    const sanitized = sanitizeForProvider(content || "", "atlassian");
    const storageHtml = markdownToConfluenceStorage(sanitized);

    const result = await createConfluencePage(title, spaceId, storageHtml, domain, email, token);

    lastCreation.set(clientKey, now);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Document creation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create document" },
      { status: 500 }
    );
  }
}
