import { FeedbackItem, ProductboardFeature, AttentionCall, Insight } from "./types";

interface VectorDocument {
  id: string;
  type: "feedback" | "feature" | "call" | "insight";
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

export class InMemoryVectorStore {
  private documents: VectorDocument[] = [];
  private idf: Map<string, number> = new Map();
  private tfidf: Map<string, Map<string, number>> = new Map();

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

  search(
    query: string,
    options?: { limit?: number; type?: VectorDocument["type"]; themes?: string[] }
  ): { document: VectorDocument; score: number }[] {
    const limit = options?.limit || 8;
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

      const docVec = this.tfidf.get(doc.id);
      if (!docVec) continue;

      let dot = 0;
      let normA = 0;
      let normB = 0;
      const allKeys = new Set<string>();
      queryVec.forEach((_, k) => allKeys.add(k));
      docVec.forEach((_, k) => allKeys.add(k));

      allKeys.forEach((key) => {
        const a = queryVec.get(key) || 0;
        const b = docVec.get(key) || 0;
        dot += a * b;
        normA += a * a;
        normB += b * b;
      });

      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      const score = denom > 0 ? dot / denom : 0;

      if (score > 0.01) {
        results.push({ document: doc, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  getDocumentById(id: string): VectorDocument | undefined {
    return this.documents.find((d) => d.id === id);
  }

  getStats() {
    return {
      total: this.documents.length,
      feedback: this.documents.filter((d) => d.type === "feedback").length,
      features: this.documents.filter((d) => d.type === "feature").length,
      calls: this.documents.filter((d) => d.type === "call").length,
      insights: this.documents.filter((d) => d.type === "insight").length,
    };
  }
}
