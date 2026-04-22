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
 * A Source cell that ends in `(<Platform> <kind>)` is treated as a specific
 * analytics or document signal — e.g. "Workflow Selection (Pendo page)",
 * "MSP Portal (Pendo feature)", "page_viewed (Amplitude event)",
 * "support@acme.com (Pendo visitor)". The cleaner accepts these as valid
 * because they unambiguously identify a citeable artifact.
 */
const PLATFORM_TAG_RE =
  /\((?:Pendo|Amplitude|PostHog|Productboard|Slite|Confluence|Jira|Linear|Grain|Attention)(?:\s+(?:page|feature|event|user|visitor|account|note|page|call|issue|ticket))?\)\s*$/i;

/**
 * Strip server-added suffixes from a stored title to get the "short handle"
 * the model is likely to copy into the Source cell. We strip:
 *  - " — contact-or-attribution" suffixes
 *  - " (1 of N from Company)" suffixes (only this NUMERIC pattern, NOT every paren)
 * We KEEP meaningful platform tags like "(Pendo page)" because those are part
 * of the source identity.
 */
function shortHandle(title: string): string {
  let t = title.split(/\s+—\s+/)[0];
  // Strip " (1 of N ...)" / " (N of M ...)" suffixes only
  t = t.replace(/\s+\(\d+\s+of\s+\d+[^)]*\)\s*$/i, "");
  // Strip " (from Company)" suffix
  t = t.replace(/\s+\(from\s+[^)]+\)\s*$/i, "");
  return t.trim();
}

/** Bare platform names that should never appear alone in a Source cell. */
const BARE_PLATFORM_RE =
  /^(?:Pendo|Amplitude|PostHog|Productboard|Slite|Confluence|Jira|Linear|Grain|Attention)$/i;

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

  // Bare platform names alone are NOT a valid source — too generic.
  // The model must say "Workflow Selection (Pendo page)" not "Pendo".
  if (BARE_PLATFORM_RE.test(c)) return false;

  // A specific signal tagged with its platform is always valid:
  //   "Workflow Selection (Pendo page)", "MSP Portal (Pendo feature)",
  //   "page_viewed (Amplitude event)", "support@acme.com (Pendo visitor)".
  if (PLATFORM_TAG_RE.test(c)) return true;

  // Ends with a sentence-ending punctuation → long prose, reject
  if (/[.!?]$/.test(c)) return false;
  // Contains internal sentence punctuation (". " or "! " or "? ") → multi-sentence prose, reject
  if (/[.!?]\s+[A-Z]/.test(c)) return false;
  // Contains a "Confidence: N/5" or "Confidence: High" fragment we sometimes
  // see leak in from analytical commentary → reject
  if (/confidence\s*[:=]/i.test(c)) return false;

  // If it matches the title or id of a known source, it's valid
  const lower = c.toLowerCase();
  if (knownSources.some((s) => {
    const sid = s.id.toLowerCase();
    const fullTitle = s.title.toLowerCase();
    const shortTitleLower = shortHandle(s.title).toLowerCase();
    return (
      lower === sid ||
      lower === fullTitle.slice(0, MAX_SOURCE_LEN) ||
      lower === shortTitleLower ||
      shortTitleLower.startsWith(lower) ||
      lower.startsWith(shortTitleLower) ||
      sid.includes(lower) ||
      lower.includes(sid)
    );
  })) return true;

  // Phrases that signal a hallucinated theme label, internal roadmap item,
  // or a platform-overview catch-all that isn't tied to a specific signal
  const BANNED_PHRASES = [
    "known feature", "known page", "known event", "known issue",
    "feature request", "the integration", "new feature", "n/a", "unknown",
    "roadmap feature", "roadmap item", "internal roadmap", "pb feature",
    "analytics overview", "usage overview",
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
    if (!s) continue;
    // For Jira/Linear-like types, prefer the ticket key embedded in the title
    // (e.g. title "CX-1234: Refactor detection" → "CX-1234").
    const keyMatch = s.title.match(/^([A-Z]{2,10}-\d+)/);
    if (keyMatch) return keyMatch[1];
    const handle = shortHandle(s.title);
    if (handle && handle.length <= MAX_SOURCE_LEN) return handle;
    return s.id;
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
 * Split a single joined-line of pipe content into N-column rows by counting
 * pipes. Returns an array of rows (each like "| a | b | c |"). Falls back to
 * `[line]` if the count doesn't divide evenly.
 */
function splitJoinedRows(line: string, columnCount: number): string[] {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return [line];
  // Count pipes (excluding escaped \|, which we don't expect in practice).
  const pipeCount = (t.match(/\|/g) || []).length;
  // A single N-column row has N+1 pipes. K rows joined share the inner pipes,
  // so total pipes = K*N + 1 if rows share boundary pipes, or K*(N+1) if they
  // each carry their own bounding pipes (which is what the model emits).
  // Try the second case first because it matches the `| ... | | ... |` pattern.
  const cellsPerRow = columnCount;
  const pipesPerRow = cellsPerRow + 1;
  if (pipeCount % pipesPerRow !== 0) return [line];
  const rowCount = pipeCount / pipesPerRow;
  if (rowCount < 2) return [line];

  // Match each `|cell|cell|...|` greedily, cellsPerRow cells per match.
  const cellPart = "\\|[^|\\n]*";
  const rowRe = new RegExp(`(?:${cellPart.repeat(cellsPerRow)})\\|`, "g");
  const matches = t.match(rowRe);
  if (!matches || matches.length !== rowCount) return [line];
  return matches.map((m) => m.trim());
}

/**
 * Pre-pass: when the model emits a Source|What|When table inline with prose
 * (no leading newline before `| Source | ...`), GFM renderers fail to parse
 * it and the entire table renders as inline pipe text. We:
 *   1. Insert a blank line before a `| Source | ... |` header preceded by prose
 *   2. Split the header / separator / joined-body rows onto their own lines
 *      using the column count derived from the separator row.
 */
function normalizeTableSplits(text: string): string {
  const HEADER_RE = /\|\s*Source\s*\|\s*(?:What|Request|Issue)\s*\|\s*(?:When|Date|Time)\s*\|/i;

  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (!HEADER_RE.test(line)) {
      out.push(line);
      continue;
    }

    // Split the line into: prose-prefix, header, separator (if joined), body (if joined)
    const headerMatch = line.match(HEADER_RE);
    if (!headerMatch || headerMatch.index === undefined) {
      out.push(line);
      continue;
    }
    const prosePrefix = line.slice(0, headerMatch.index).trim();
    const header = headerMatch[0];
    const remainder = line.slice(headerMatch.index + header.length).trim();

    if (prosePrefix) {
      out.push(prosePrefix);
      out.push(""); // blank line so GFM parses the table
    }
    out.push(header);

    if (!remainder) continue;

    // Try to peel a separator row off the start of the remainder
    const sepMatch = remainder.match(/^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|/);
    if (sepMatch) {
      const sep = sepMatch[0];
      const columnCount = (sep.match(/\|/g) || []).length - 1;
      out.push(sep);
      const bodyJoined = remainder.slice(sep.length).trim();
      if (bodyJoined) {
        const rows = splitJoinedRows(bodyJoined, columnCount);
        for (const row of rows) out.push(row);
      }
    } else {
      // No joined separator — just emit remainder verbatim on the next line
      out.push(remainder);
    }
  }
  return out.join("\n");
}

/**
 * Main entry point. Cleans Source cells in the Source|What|When table(s)
 * found in `text`. Non-matching tables are left untouched.
 */
export function cleanResponseTables(text: string, sources: SourceRef[]): string {
  if (!text.includes("|")) return text;

  // Normalize table placement first so that inline-with-prose tables become
  // properly delimited, line-based tables that the rest of the cleaner can
  // process and that GFM renderers can parse downstream.
  text = normalizeTableSplits(text);

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
