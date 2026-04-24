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
  /** Ground-truth relative-date label, computed at source-build time.
   *  Used to overwrite the When cell when the model hallucinates it. */
  when?: string;
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
  // Strip " (N items)" annotation (added when multiple feedback items share
  // the same company, so the Source column stays clean — "Acme" not
  // "Acme (3 items)")
  t = t.replace(/\s+\(\d+\s+items?\)\s*$/i, "");
  // Strip " (from Company)" suffix
  t = t.replace(/\s+\(from\s+[^)]+\)\s*$/i, "");
  // "vote: FeatureName" and "feedback on: FeatureName" are the identity prefixes
  // injected by the resolver. Strip them so cell matching compares the identity
  // token (e.g. "vote: Centralized Insights") cleanly without suffix clutter.
  // We keep the prefix so that model copies "vote: X" which is still human-readable.
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
  // a platform vote-portal title, or a platform-overview catch-all that isn't
  // tied to a specific signal
  const BANNED_PHRASES = [
    "known feature", "known page", "known event", "known issue",
    "feature request", "the integration", "new feature", "n/a", "unknown",
    "roadmap feature", "roadmap item", "internal roadmap", "pb feature",
    "analytics overview", "usage overview",
    // Generic Productboard note title patterns — identity resolver should
    // have replaced these with company/email/vote:/feedback on: but guard
    // here in case the model copies the raw title anyway.
    "vote for ", "direct feedback for", "blumira portal", "untitled note",
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
 * Pre-pass: the model sometimes glues numbered list items together inline,
 * e.g. `...first point. 2. **Second bet** — ...third sentence. 3. **Third**`.
 * That renders as one paragraph in GFM because each item must start its
 * own line. We detect inline `<sentence-end> N. **` patterns and split
 * them onto their own lines with a blank line between for visual breathing
 * room. Only triggers on bold-title-led items so we don't falsely break
 * ordinary "We had 3. issues" prose.
 */
function normalizeNumberedListItems(text: string): string {
  // Insert a blank line before any "<sentence-end> N. **Title**" pattern
  // when it appears inline with prior prose. Match sentence-ending
  // punctuation followed by spaces then `N. **` (N = 1-9, single digit).
  return text.replace(
    /([.!?])\s+(\d{1,2}\.\s+\*\*)/g,
    (_, punct, itemStart) => `${punct}\n\n${itemStart}`,
  );
}

/**
 * Pre-pass: the model sometimes glues section headings onto the end of the
 * previous prose line, e.g. `...alert processing. ## Usage Signals`. GFM
 * requires `##` to start a fresh line (ideally with a blank line above), so
 * we split `<sentence-end> ## Heading` into two lines with a blank gap, and
 * ensure there's a blank line between a heading and any immediately-following
 * pipe-table row.
 */
// The citation-marker component only recognizes single-number brackets like [5].
// Models frequently emit multi-number citations like [7, 11, 18] which render as
// raw text. Expand those into individual markers so each one becomes clickable.
function expandMultiCitations(text: string): string {
  // Table pipe-separators look like `|---|---|` — don't touch them. Only match
  // [digit, digit, ...] where at least two comma-separated numbers are inside.
  return text.replace(/\[\s*(\d+(?:\s*,\s*\d+)+)\s*\]/g, (_match, inner) => {
    const nums = (inner as string).split(/\s*,\s*/).map((n: string) => n.trim()).filter(Boolean);
    return nums.map((n: string) => `[${n}]`).join("");
  });
}

// When the model writes `> "quote"` mid-line instead of on its own line, the
// markdown blockquote syntax fails and the reader sees a literal ">". Move any
// such inline `> "..."` span onto its own line with surrounding blank lines.
// Also handles: multiple quotes stacked on one line, and a trailing `### Heading`
// after an attribution close-paren — both have been observed in real output.
function normalizeInlineBlockquotes(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];

  const splitInlineQuotes = (rawLine: string): string[] => {
    // Split on every `>` that isn't already at line start. Keep the `>` with each fragment.
    // Example: `foo. > "q1" — a (3d ago) > "q2" — b (Jan 1) ### Heading`
    //   → ["foo.", `> "q1" — a (3d ago)`, `> "q2" — b (Jan 1)`, "### Heading"]
    const parts: string[] = [];
    let remaining = rawLine;
    // First, split off any heading that was smashed onto the end of the line after `)`
    const headingMatch = remaining.match(/^(.*?\))\s+(#{1,6}\s+\S.*)$/);
    if (headingMatch) {
      remaining = headingMatch[1];
      parts.push("__HEADING__" + headingMatch[2]);
    }
    // Split on runs like ` > "..."` (space + caret-angle + quote). Keep the prefix and each quote block.
    const QUOTE_SPLIT_RE = /\s+(?=>\s*")/g;
    const segments = remaining.split(QUOTE_SPLIT_RE);
    // First segment is pre-quote prose; the rest each start with `>`.
    const result: string[] = [];
    if (segments[0] && !segments[0].trimStart().startsWith(">")) {
      result.push(segments[0].trimEnd());
    }
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg && seg.trimStart().startsWith(">")) result.push(seg.trim());
    }
    // Re-append the heading if we stashed one
    if (parts.length) result.push(parts[0].replace(/^__HEADING__/, ""));
    return result;
  };

  for (const line of lines) {
    // Already a properly-formatted blockquote line — may still contain stacked quotes.
    if (/^\s*>/.test(line)) {
      // Split stacked quotes inside a single blockquote line: `> "q1" — a (3d) > "q2" — b (Jan)`
      if (/>\s*"[^"]{4,}".{0,200}?>\s*"/.test(line)) {
        const parts = splitInlineQuotes(line);
        let first = true;
        for (const p of parts) {
          if (!first) out.push("");
          out.push(p.trimStart().startsWith(">") ? p : `> ${p}`);
          first = false;
        }
        out.push("");
        continue;
      }
      out.push(line);
      continue;
    }
    // Look for inline `> "..."` in otherwise-prose lines.
    if (/>\s*"[^"]{10,}"/.test(line)) {
      const parts = splitInlineQuotes(line);
      if (parts.length > 1) {
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          // Blank line before every blockquote or heading
          if ((p.startsWith(">") || /^#{1,6}\s/.test(p)) && out.length && out[out.length - 1] !== "") out.push("");
          out.push(p);
          if (p.startsWith(">") || /^#{1,6}\s/.test(p)) out.push("");
        }
        continue;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

function normalizeHeadingPlacement(text: string): string {
  // Split inline headings like "text. ## Heading more" into their own lines
  const INLINE_HEADING_RE = /^(.+?[.!?])\s+(#{1,6}\s+.+)$/;
  const split: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(INLINE_HEADING_RE);
    if (m) {
      split.push(m[1]);
      split.push("");
      split.push(m[2]);
    } else {
      split.push(line);
    }
  }
  // Guarantee a blank line before and after a heading when surrounded by
  // content (so headings don't get absorbed into adjacent paragraphs/tables).
  const out: string[] = [];
  for (let i = 0; i < split.length; i++) {
    const line = split[i];
    const isHeading = /^#{1,6}\s+\S/.test(line);
    if (isHeading) {
      // Prepend blank line if previous line has content
      if (out.length > 0 && out[out.length - 1].trim() !== "") {
        out.push("");
      }
      out.push(line);
      // Append blank line if next line has content
      if (i + 1 < split.length && split[i + 1].trim() !== "") {
        out.push("");
      }
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
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
 * Find the SourceRef whose id/title matches the given Source-cell value.
 * Mirrors the match rules in isValidSourceCell so a cell we accepted as
 * valid also resolves back to its source record.
 */
function findSourceForCell(cell: string, sources: SourceRef[]): SourceRef | null {
  const raw = cell.trim();
  if (!raw) return null;

  // Exact source-id match (the model sometimes echoes the raw doc id,
  // e.g. a UUID, when it can't pick a short handle). Do this FIRST so
  // enforcement works even for unhelpful-looking cells.
  const lowerRaw = raw.toLowerCase();
  const byId = sources.find((s) => s.id.toLowerCase() === lowerRaw);
  if (byId) return byId;

  // Leading `[N]` or `N ` citation prefix → try index-based lookup.
  // The model sometimes writes e.g. "[17] Pre-populate filter values" or
  // "17 Pre-populate filter values" as the Source cell, copying the citation
  // index from the evidence list. Map it back to sources[N-1] directly.
  const citeMatch = raw.match(/^\[?(\d{1,3})\]?[\s.:—-]+(.*)$/);
  const stripped = citeMatch ? citeMatch[2].trim() : raw;
  if (citeMatch) {
    const idx = parseInt(citeMatch[1], 10) - 1;
    if (idx >= 0 && idx < sources.length) return sources[idx];
  }

  const c = stripped || raw;

  // Ticket key match (strip brackets/markdown link syntax if present)
  const keyMatch = c.match(/^\[?([A-Z]{2,10}-\d+)\]?/);
  if (keyMatch) {
    const key = keyMatch[1].toLowerCase();
    const byKey = sources.find((s) => {
      const idMatch = s.id.toLowerCase().includes(key);
      const titleMatch = s.title.toLowerCase().startsWith(key);
      return idMatch || titleMatch;
    });
    if (byKey) return byKey;
  }
  // Email match: title may carry " — email@..." as contact suffix, OR the
  // email may BE the identity lead of a feedback title like
  // "support@acme.com — Add host info…".
  if (EMAIL_RE.test(c)) {
    const lc = c.toLowerCase();
    const byEmail = sources.find((s) => s.title.toLowerCase().includes(lc));
    if (byEmail) return byEmail;
  }
  // Exact/prefix title match on the short handle
  const lower = c.toLowerCase();
  return sources.find((s) => {
    const sh = shortHandle(s.title).toLowerCase();
    return sh === lower || sh.startsWith(lower) || lower.startsWith(sh);
  }) || null;
}

/**
 * Overwrite the When cell with the source's ground-truth `when` label when
 * the two disagree. This blocks the common model drift of writing "today"
 * for every row even when the evidence carries real relative dates.
 * Row layout assumed: [Source, What, When] for the canonical table.
 */
function enforceWhenCell(rowCells: string[], sources: SourceRef[]): void {
  if (rowCells.length < 3) return;
  const source = findSourceForCell(rowCells[0], sources);
  if (!source || !source.when) return;
  const written = rowCells[2].trim();
  // Accept the model's value only when it already matches ground truth.
  // Anything else — "today" hallucinations, arbitrary prose, empty — is
  // replaced with the computed label.
  if (written.toLowerCase() === source.when.toLowerCase()) return;
  rowCells[2] = source.when;
}

/**
 * Collapse body-row overflow into the first cell for any markdown table.
 * Applied as a pre-pass so ALL tables (Source|What|When and analytics-shape
 * alike) survive unescaped `|` chars in cell values.
 */
function fixPipeOverflowInAllTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!isPipeRow(line) || !(i + 1 < lines.length && isSeparatorRow(lines[i + 1]))) {
      out.push(line);
      i++;
      continue;
    }
    // Found a header + separator pair
    const expected = parsePipeRow(line).length;
    out.push(line);
    out.push(lines[i + 1]);
    i += 2;
    while (i < lines.length && isPipeRow(lines[i])) {
      const rowCells = parsePipeRow(lines[i]);
      if (rowCells.length > expected && expected >= 2) {
        const overflow = rowCells.length - expected;
        const merged = [rowCells.slice(0, overflow + 1).join(" › "), ...rowCells.slice(overflow + 1)];
        out.push(buildPipeRow(merged));
      } else {
        out.push(lines[i]);
      }
      i++;
    }
  }
  return out.join("\n");
}

/**
 * Main entry point. Cleans Source cells in the Source|What|When table(s)
 * found in `text`. Non-matching tables are left untouched.
 */
export function cleanResponseTables(text: string, sources: SourceRef[]): string {
  // Always normalize heading placement + inline numbered items — applies to
  // ALL responses, not just ones containing tables, because these are
  // rendering bugs regardless of whether tables follow.
  text = normalizeNumberedListItems(text);
  text = normalizeHeadingPlacement(text);
  text = normalizeInlineBlockquotes(text);
  text = expandMultiCitations(text);

  if (!text.includes("|")) return text;

  // Normalize table placement first so that inline-with-prose tables become
  // properly delimited, line-based tables that the rest of the cleaner can
  // process and that GFM renderers can parse downstream.
  text = normalizeTableSplits(text);
  // Repair any table where body rows have more cells than the header.
  text = fixPipeOverflowInAllTables(text);

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

        // Process body rows. Cell counts are already normalized by
        // fixPipeOverflowInAllTables above, so any remaining invalid Source
        // cells are actual content problems, not pipe-escape artifacts.
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
                enforceWhenCell(rowCells, sources);
                output.push(buildPipeRow(rowCells));
              }
              // else: drop the row (don't push)
            } else {
              enforceWhenCell(rowCells, sources);
              output.push(buildPipeRow(rowCells));
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
