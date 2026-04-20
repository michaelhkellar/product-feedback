import { FeedbackItem, ProductboardFeature, AttentionCall, Insight, JiraIssue, ConfluencePage, LinearIssue } from "./types";

export interface VectorDocument {
  id: string;
  type: "feedback" | "feature" | "call" | "insight" | "jira" | "confluence" | "linear";
  text: string;
  themes: string[];
  metadata: Record<string, string>;
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
  private documents: VectorDocument[] = [];
  private idf: Map<string, number> = new Map();
  private tfidf: Map<string, Map<string, number>> = new Map();
  private docById: Map<string, VectorDocument> = new Map();
  private embeddings: Map<string, number[]> = new Map();

  addFeedback(items: FeedbackItem[]) {
    for (const item of items) {
      this.documents.push({
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
        },
      });
    }
  }

  addFeatures(features: ProductboardFeature[]) {
    for (const f of features) {
      this.documents.push({
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
      this.documents.push({
        id: c.id,
        type: "call",
        text: `${c.title} ${c.summary} ${moments} ${c.actionItems.join(" ")} ${c.themes.join(" ")}`,
        themes: c.themes,
        metadata: { date: c.date, participants: c.participants.join(", ") },
      });
    }
  }

  addInsights(insights: Insight[]) {
    for (const i of insights) {
      this.documents.push({
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
      this.documents.push({
        id: issue.id,
        type: "jira",
        text: `${issue.key} ${issue.summary} ${issue.description} ${issue.labels.join(" ")} ${issue.project} ${issue.issueType} ${issue.status}`,
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
      this.documents.push({
        id: issue.id,
        type: "linear",
        text: `${issue.identifier} ${issue.title} ${issue.description} ${issue.labels.join(" ")} ${issue.team} ${issue.status}`,
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
      this.documents.push({
        id: page.id,
        type: "confluence",
        text: `${page.title} ${page.excerpt} ${page.space}`,
        themes: [],
        metadata: {
          space: page.space,
          author: page.author,
          url: page.url,
        },
      });
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
      this.docById.set(doc.id, doc);
    }
  }

  /** Supply pre-computed embeddings keyed by document id. Call after buildIndex(). */
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

  search(
    query: string,
    options?: { limit?: number; type?: VectorDocument["type"]; themes?: string[]; queryEmbedding?: number[] }
  ): { document: VectorDocument; score: number }[] {
    const limit = options?.limit || 8;
    const useEmbeddings = !!options?.queryEmbedding && this.embeddings.size > 0;

    // TF-IDF query vector (always built as fallback)
    const queryTokens = tokenize(query);
    const queryTF = computeTF(queryTokens);
    const queryVec = new Map<string, number>();
    queryTF.forEach((tfVal, token) => {
      queryVec.set(token, tfVal * (this.idf.get(token) || 0));
    });

    const results: { document: VectorDocument; score: number }[] = [];

    for (const doc of this.documents) {
      if (options?.type && doc.type !== options.type) continue;
      if (options?.themes?.length) {
        const overlap = doc.themes.some((t) => options.themes!.includes(t));
        if (!overlap) continue;
      }

      let score = 0;

      if (useEmbeddings) {
        const docEmb = this.embeddings.get(doc.id);
        if (docEmb?.length) {
          score = cosineSim(options!.queryEmbedding!, docEmb);
        } else {
          // Fall back to TF-IDF for docs without embeddings
          const docVec = this.tfidf.get(doc.id);
          if (docVec) score = this._tfidfScore(queryVec, docVec) * 0.7;
        }
      } else {
        const docVec = this.tfidf.get(doc.id);
        if (!docVec) continue;
        score = this._tfidfScore(queryVec, docVec);
      }

      if (score > 0.01) results.push({ document: doc, score });
    }

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
    };
  }
}
