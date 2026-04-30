import { FeedbackItem, ProductboardFeature, AttentionCall, Insight, JiraIssue, ConfluencePage, LinearIssue } from "./types";

export interface VectorDocument {
  id: string;
  type: "feedback" | "feature" | "call" | "insight" | "jira" | "confluence" | "linear" | "analytics";
  text: string;
  themes: string[];
  metadata: Record<string, string>;
  // Chunking fields: set on chunk documents; absent on short/standalone docs.
  parentId?: string;
  chunkIndex?: number;
  signalScore?: number;
}

// Sentence-split text into ~maxLen char windows with overlap.
// Returns [text] unchanged if text.length <= CHUNK_THRESHOLD.
const CHUNK_THRESHOLD = 600;
const CHUNK_MAX = 280;
const CHUNK_OVERLAP = 60;
const CHUNK_CAP = 50;

function chunkText(text: string, maxLen = CHUNK_MAX, overlap = CHUNK_OVERLAP): string[] {
  if (text.length <= CHUNK_THRESHOLD) return [text];

  // Split on sentence boundaries first
  const sentenceRe = /(?<=[.!?])\s+/;
  const rawSentences = text.split(sentenceRe).filter((s) => s.length > 0);

  const windows: string[] = [];
  let current = "";

  for (const sentence of rawSentences) {
    // If a single sentence is too long, sub-split on commas then whitespace
    const parts: string[] = sentence.length > maxLen
      ? sentence.split(/,\s*/).flatMap((p) =>
          p.length > maxLen ? p.match(new RegExp(`.{1,${maxLen}}`, "g")) ?? [p] : [p]
        )
      : [sentence];

    for (const part of parts) {
      if ((current + " " + part).trim().length <= maxLen) {
        current = current ? current + " " + part : part;
      } else {
        if (current) windows.push(current.trim());
        // Carry overlap from end of previous window
        const tail = current.slice(-overlap);
        current = tail ? tail + " " + part : part;
      }
    }
  }
  if (current.trim()) windows.push(current.trim());

  // Cap to CHUNK_CAP windows
  return windows.slice(0, CHUNK_CAP);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function computeTF(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  let max = 1;
  freq.forEach((v) => { if (v > max) max = v; });
  const tf = new Map<string, number>();
  freq.forEach((v, k) => { tf.set(k, v / max); });
  return tf;
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

export class InMemoryVectorStore {
  // Search candidates: chunks + short standalone docs (no parent docs)
  private documents: VectorDocument[] = [];
  // Parent docs for long sources — used for result hydration after chunk aggregation
  private parentDocs: Map<string, VectorDocument> = new Map();
  private idf: Map<string, number> = new Map();
  private tfidf: Map<string, Map<string, number>> = new Map();
  private docById: Map<string, VectorDocument> = new Map();
  private embeddings: Map<string, number[]> = new Map();

  private addDoc(doc: VectorDocument): void {
    this.documents.push(doc);
    this.docById.set(doc.id, doc);
  }

  /**
   * Chunk a long text and emit search documents.
   *
   * @param chunkPrefix optional text prepended to *every* chunk's `text`. Use this for
   * source-anchor hints (e.g. `[Source: URL]\n`) so any chunk retrieved later still
   * carries a back-pointer, not just the first one.
   */
  private addChunked(
    item: { id: string },
    fullText: string,
    parentDoc: Omit<VectorDocument, "id" | "text" | "parentId" | "chunkIndex">,
    chunkPrefix: string = ""
  ): void {
    const chunks = chunkText(fullText);
    if (chunks.length === 1) {
      // Short enough to keep as a single document
      this.addDoc({ ...parentDoc, id: item.id, text: chunkPrefix + chunks[0] });
    } else {
      // Store the parent doc for hydration; add chunks to search index
      const parent: VectorDocument = { ...parentDoc, id: item.id, text: chunkPrefix + fullText };
      this.parentDocs.set(item.id, parent);
      this.docById.set(item.id, parent);
      for (let i = 0; i < chunks.length; i++) {
        this.addDoc({
          ...parentDoc,
          id: `${item.id}#c${i}`,
          // Re-inject prefix on every chunk so retrieval results from any position in the
          // document (not just the opening) carry the source back-pointer.
          text: chunkPrefix + chunks[i],
          parentId: item.id,
          chunkIndex: i,
        });
      }
    }
  }

  addFeedback(items: FeedbackItem[]) {
    for (const item of items) {
      // Feedback items are short by design; never chunk — clustering depends on item-level granularity.
      this.addDoc({
        id: item.id,
        type: "feedback",
        text: `${item.title} ${item.content} ${item.themes.join(" ")} ${item.customer} ${item.company || ""}`,
        themes: item.themes,
        metadata: {
          source: item.source,
          sentiment: item.sentiment,
          priority: item.priority,
          customer: item.customer,
          company: item.company || "",
          urgency: item.urgency || "",
          actionability: item.actionability || "",
          topicArea: item.topicArea || "",
        },
      });
    }
  }

  addFeatures(features: ProductboardFeature[]) {
    for (const f of features) {
      this.addDoc({
        id: f.id,
        type: "feature",
        text: `${f.name} ${f.description} ${f.themes.join(" ")}`,
        themes: f.themes,
        metadata: { status: f.status, votes: String(f.votes) },
      });
    }
  }

  addCalls(calls: AttentionCall[]) {
    for (const c of calls) {
      const moments = c.keyMoments.map((m) => m.text).join(" ");
      // Prefer the full transcript when available so quotes from the middle and end of calls
      // are searchable, not just opening pleasantries.
      const body = c.transcript || c.summary;
      const fullText = `${c.title}\n${body}\n${moments}\n${c.actionItems.join(" ")}\n${c.themes.join(" ")}\n${c.callType || ""}`;
      // Source anchor injected per-chunk via chunkPrefix so every retrieved chunk —
      // not just the opening one — carries a URL back-pointer for citation linkbacks.
      const chunkPrefix = c.url ? `[Source: ${c.url}]\n` : "";
      this.addChunked(c, fullText, {
        type: "call",
        themes: c.themes,
        metadata: {
          date: c.date,
          participants: c.participants.join(", "),
          url: c.url || "",
          callType: c.callType || "",
        },
      }, chunkPrefix);
    }
  }

  addInsights(insights: Insight[]) {
    for (const i of insights) {
      this.addDoc({
        id: i.id,
        type: "insight",
        text: `${i.title} ${i.description} ${i.themes.join(" ")}`,
        themes: i.themes,
        metadata: { type: i.type, impact: i.impact },
      });
    }
  }

  addJiraIssues(issues: JiraIssue[]) {
    for (const issue of issues) {
      const fullText = `${issue.key} ${issue.summary} ${issue.description} ${issue.labels.join(" ")} ${issue.project} ${issue.issueType} ${issue.status}`;
      this.addChunked(issue, fullText, {
        type: "jira",
        themes: issue.labels,
        metadata: {
          key: issue.key,
          status: issue.status,
          type: issue.issueType,
          priority: issue.priority,
          project: issue.project,
          assignee: issue.assignee,
        },
      });
    }
  }

  addLinearIssues(issues: LinearIssue[]) {
    for (const issue of issues) {
      const fullText = `${issue.identifier} ${issue.title} ${issue.description} ${issue.labels.join(" ")} ${issue.team} ${issue.status}`;
      this.addChunked(issue, fullText, {
        type: "linear",
        themes: issue.labels,
        metadata: {
          key: issue.identifier,
          status: issue.status,
          priority: issue.priority,
          team: issue.team,
          assignee: issue.assignee,
          url: issue.url,
        },
      });
    }
  }

  addConfluencePages(pages: ConfluencePage[]) {
    for (const page of pages) {
      // Excerpt may already be truncated by the API; treat defensively with chunkText.
      const fullText = `${page.title} ${page.excerpt} ${page.space}`;
      this.addChunked(page, fullText, {
        type: "confluence",
        themes: [],
        metadata: {
          space: page.space,
          author: page.author,
          url: page.url,
        },
      });
    }
  }

  addAnalytics(docs: VectorDocument[]) {
    for (const doc of docs) {
      this.addDoc(doc);
    }
  }

  buildIndex() {
    const N = this.documents.length;
    const docFreq = new Map<string, number>();

    for (const doc of this.documents) {
      const uniqueTokens = new Set(tokenize(doc.text));
      uniqueTokens.forEach((token) => {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      });
    }

    docFreq.forEach((freq, token) => {
      this.idf.set(token, Math.log(N / freq));
    });

    for (const doc of this.documents) {
      const tokens = tokenize(doc.text);
      const tf = computeTF(tokens);
      const vec = new Map<string, number>();
      tf.forEach((tfVal, token) => {
        vec.set(token, tfVal * (this.idf.get(token) || 0));
      });
      this.tfidf.set(doc.id, vec);
    }
  }

  /** Supply pre-computed embeddings keyed by document id (including chunk ids). */
  setEmbeddings(embeddings: Map<string, number[]>) {
    this.embeddings = embeddings;
  }

  /** Build embeddings for all documents using the supplied embed function. */
  async buildEmbeddings(embedFn: (texts: string[]) => Promise<number[][] | null>) {
    const BATCH = 64;
    for (let i = 0; i < this.documents.length; i += BATCH) {
      const batch = this.documents.slice(i, i + BATCH);
      try {
        const vecs = await embedFn(batch.map((d) => d.text.slice(0, 512)));
        if (vecs) {
          batch.forEach((doc, j) => {
            if (vecs[j]?.length) this.embeddings.set(doc.id, vecs[j]);
          });
        }
      } catch { /* non-fatal; TF-IDF fallback remains */ }
    }
  }

  /** Return all search-candidate documents (chunks + standalone). Used to get chunk IDs for external embedding. */
  getAllDocuments(): VectorDocument[] {
    return this.documents;
  }

  search(
    query: string,
    options?: {
      limit?: number;
      type?: VectorDocument["type"];
      themes?: string[];
      queryEmbedding?: number[];
      minUrgency?: "high" | "medium" | "low";
      requireActionable?: boolean;
      applySignalBoost?: boolean;
    }
  ): { document: VectorDocument; score: number; highlightSpan?: string }[] {
    const limit = options?.limit || 8;
    const K = 60; // RRF constant
    const URGENCY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const minUrgencyRank = options?.minUrgency ? (URGENCY_RANK[options.minUrgency] || 0) : 0;

    // Build TF-IDF query vector
    const queryTokens = tokenize(query);
    const queryTF = computeTF(queryTokens);
    const queryVec = new Map<string, number>();
    queryTF.forEach((tfVal, token) => {
      queryVec.set(token, tfVal * (this.idf.get(token) || 0));
    });

    // Filter candidates
    const candidates = this.documents.filter((doc) => {
      if (options?.type && doc.type !== options.type) return false;
      if (options?.themes?.length) {
        if (!doc.themes.some((t) => options.themes!.includes(t))) return false;
      }
      if (doc.type === "feedback") {
        if (minUrgencyRank > 0) {
          const docUrgencyRank = URGENCY_RANK[doc.metadata.urgency] || 0;
          if (docUrgencyRank < minUrgencyRank) return false;
        }
        if (options?.requireActionable && doc.metadata.actionability !== "high") return false;
      }
      return true;
    });

    // TF-IDF pass
    const tfidfScored: { id: string; score: number }[] = [];
    const tfidfScoreMap = new Map<string, number>();
    for (const doc of candidates) {
      const docVec = this.tfidf.get(doc.id);
      if (!docVec) continue;
      const score = this._tfidfScore(queryVec, docVec);
      if (score > 0.005) {
        tfidfScored.push({ id: doc.id, score });
        tfidfScoreMap.set(doc.id, score);
      }
    }
    tfidfScored.sort((a, b) => b.score - a.score);
    const tfidfRankMap = new Map<string, number>();
    tfidfScored.forEach(({ id }, i) => tfidfRankMap.set(id, i));

    // Embedding pass
    const useEmbeddings = !!options?.queryEmbedding && this.embeddings.size > 0;
    const embRankMap = new Map<string, number>();
    if (useEmbeddings) {
      const embScored: { id: string; score: number }[] = [];
      for (const doc of candidates) {
        const emb = this.embeddings.get(doc.id);
        if (emb?.length) {
          const score = cosineSim(options!.queryEmbedding!, emb);
          if (score > 0.2) embScored.push({ id: doc.id, score });
        }
      }
      embScored.sort((a, b) => b.score - a.score);
      embScored.forEach(({ id }, i) => embRankMap.set(id, i));
    }

    // RRF fusion over chunk/standalone doc ids
    const allIds = new Set<string>([...Array.from(tfidfRankMap.keys()), ...Array.from(embRankMap.keys())]);
    const worstTfidf = tfidfScored.length;
    const worstEmb = embRankMap.size;

    const chunkResults: { id: string; score: number; doc: VectorDocument }[] = [];
    for (const id of Array.from(allIds)) {
      const doc = this.docById.get(id);
      if (!doc) continue;

      let score: number;
      if (useEmbeddings && embRankMap.size > 0) {
        const tr = tfidfRankMap.has(id) ? tfidfRankMap.get(id)! : worstTfidf;
        const er = embRankMap.has(id) ? embRankMap.get(id)! : worstEmb;
        score = 1 / (K + tr) + 1 / (K + er);
      } else {
        score = tfidfScoreMap.get(id) || 0;
      }

      // Apply signal boost (multiplicative, non-suppressive) except for count queries
      if (options?.applySignalBoost && doc.signalScore !== undefined) {
        score *= doc.signalScore;
      }

      chunkResults.push({ id, score, doc });
    }
    chunkResults.sort((a, b) => b.score - a.score);

    // Aggregate chunks → parent docs
    const byParent = new Map<string, { document: VectorDocument; score: number; highlightSpan?: string }>();
    for (const { doc, score } of chunkResults) {
      const parentId = doc.parentId ?? doc.id;
      const existing = byParent.get(parentId);
      if (!existing || score > existing.score) {
        // Hydrate to parent doc if this is a chunk
        const parentDoc = doc.parentId ? (this.parentDocs.get(doc.parentId) ?? doc) : doc;
        byParent.set(parentId, {
          document: parentDoc,
          score,
          highlightSpan: doc.parentId ? doc.text : undefined,
        });
      }
    }

    const results = Array.from(byParent.values());
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  private _tfidfScore(queryVec: Map<string, number>, docVec: Map<string, number>): number {
    let dot = 0, normA = 0, normB = 0;
    const allKeys = new Set<string>();
    queryVec.forEach((_, k) => allKeys.add(k));
    docVec.forEach((_, k) => allKeys.add(k));
    allKeys.forEach((key) => {
      const a = queryVec.get(key) || 0;
      const b = docVec.get(key) || 0;
      dot += a * b; normA += a * a; normB += b * b;
    });
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  getDocumentById(id: string): VectorDocument | undefined {
    return this.docById.get(id);
  }

  getStats() {
    return {
      total: this.documents.length,
      feedback: this.documents.filter((d) => d.type === "feedback").length,
      features: this.documents.filter((d) => d.type === "feature").length,
      calls: this.documents.filter((d) => d.type === "call").length,
      insights: this.documents.filter((d) => d.type === "insight").length,
      jira: this.documents.filter((d) => d.type === "jira").length,
      confluence: this.documents.filter((d) => d.type === "confluence").length,
      analytics: this.documents.filter((d) => d.type === "analytics").length,
    };
  }
}
