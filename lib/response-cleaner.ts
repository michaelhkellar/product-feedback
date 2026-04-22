/**
 * Post-processes LLM response text to fix malformed Source cells in
 * the canonical "| Source | What | When |" table.
 *
 * The model occasionally emits theme labels ("known feature"), long prose
 * descriptions, or citation markers as Source values. This module:
 *   1. Detects the Source|What|When table (first or only table matching that header pattern).
 *   2. For each body row, validates the Source cell.
 *   3. Attempts recovery by substituting the real source ID from an [n] citation
 *      in the What cell when the Source cell is invalid.
 *   4. Drops rows that still have an invalid Source cell after recovery.
 */

interface SourceRef {
  id: string;
  title: string;
  type: string;
}

/** Patterns that constitute a valid Source cell value. */
const TICKET_KEY_RE = /^(?:\[)?[A-Z]{2,10}-\d+(?:\])?/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SOURCE_LEN = 80;

/**
 * A source cell is valid when it is:
 * - A Jira / Linear key (e.g. CX-1234 or [CX-1234](url))
 * - An email address
 * - A short string (≤ MAX_SOURCE_LEN chars) that is not obviously a theme label
 *   or bare sentence
 */
function isValidSourceCell(cell: string, knownSources: SourceRef[]): boolean {
  const c = cell.trim();
  if (!c || c === "—" || c === "-") return true; // empty/dash = intentional blank
  if (c.length > MAX_SOURCE_LEN) return false;
  if (TICKET_KEY_RE.test(c)) return true;
  if (EMAIL_RE.test(c)) return true;

  // Ends with a sentence-ending punctuation → long prose, reject
  if (/[.!?]$/.test(c)) return false;

  // If it matches the title or id of a known source, it's valid
  const lower = c.toLowerCase();
  if (knownSources.some((s) =>
    lower === s.id.toLowerCase() ||
    lower === s.title.toLowerCase().slice(0, MAX_SOURCE_LEN) ||
    s.id.toLowerCase().includes(lower) ||
    lower.includes(s.id.toLowerCase())
  )) return true;

  // Phrases that signal a hallucinated theme label or internal roadmap item
  const BANNED_PHRASES = [
    "known feature", "known page", "known event", "known issue",
    "feature request", "the integration", "new feature", "n/a", "unknown",
    "roadmap feature", "roadmap item", "internal roadmap", "pb feature",
  ];
  if (BANNED_PHRASES.some((bp) => lower.includes(bp))) return false;

  // Multiple words with no punctuation that look like a short real source title
  // are allowed (e.g. "Salesforce sync request"). We trust the length cap above.
  return true;
}

/** Extract [n] citation indices from a What cell string. */
function extractCitationIndices(what: string): number[] {
  const indices: number[] = [];
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(what)) !== null) {
    indices.push(parseInt(m[1], 10) - 1); // convert to 0-based
  }
  return indices;
}

/** Try to recover a valid source string from citation indices. */
function recoverSourceFromCitations(indices: number[], sources: SourceRef[]): string | null {
  for (const idx of indices) {
    const s = sources[idx];
    if (s) return s.id;
  }
  return null;
}

/** Parse a markdown pipe-row into cells. */
function parsePipeRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** Reassemble cells into a pipe-row. */
function buildPipeRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/**
 * Detect whether a header row matches the canonical Source|What|When shape.
 * We accept minor variations in column names.
 */
function isSourceWhatWhenHeader(cells: string[]): boolean {
  if (cells.length < 3) return false;
  const [c0, c1, c2] = cells.map((c) => c.toLowerCase().trim());
  return (
    c0.includes("source") &&
    (c1.includes("what") || c1.includes("request") || c1.includes("issue")) &&
    (c2.includes("when") || c2.includes("date") || c2.includes("time"))
  );
}

function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  return /^\|[\s:|-]+\|$/.test(trimmed) && trimmed.includes("---");
}

function isPipeRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.split("|").length >= 4;
}

/**
 * Main entry point. Cleans Source cells in the Source|What|When table(s)
 * found in `text`. Non-matching tables are left untouched.
 */
export function cleanResponseTables(text: string, sources: SourceRef[]): string {
  if (!text.includes("|")) return text;

  const lines = text.split("\n");
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Detect a pipe header row
    if (isPipeRow(line)) {
      const cells = parsePipeRow(line);

      // Check if this is our canonical Source|What|When table
      if (isSourceWhatWhenHeader(cells)) {
        // Emit the header
        output.push(line);
        i++;

        // Emit separator row(s) verbatim
        while (i < lines.length && isSeparatorRow(lines[i])) {
          output.push(lines[i]);
          i++;
        }

        // Process body rows
        while (i < lines.length && isPipeRow(lines[i])) {
          const row = lines[i];
          const rowCells = parsePipeRow(row);
          if (rowCells.length >= 2) {
            const sourceCell = rowCells[0];
            const whatCell = rowCells[1] || "";

            if (!isValidSourceCell(sourceCell, sources)) {
              // Attempt recovery via [n] citation in What cell
              const indices = extractCitationIndices(whatCell);
              const recovered = recoverSourceFromCitations(indices, sources);
              if (recovered) {
                rowCells[0] = recovered;
                output.push(buildPipeRow(rowCells));
              }
              // else: drop the row (don't push)
            } else {
              output.push(row);
            }
          } else {
            output.push(row);
          }
          i++;
        }
        continue;
      }
    }

    output.push(line);
    i++;
  }

  return output.join("\n");
}
