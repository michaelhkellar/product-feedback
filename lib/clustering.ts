import { FeedbackItem } from "./types";

export interface FeedbackCluster {
  id: string;
  representativeId: string;
  memberIds: string[];
  size: number;
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const d = Math.sqrt(normA) * Math.sqrt(normB);
  return d > 0 ? dot / d : 0;
}

/**
 * Greedy single-pass clustering: assign each item to the nearest existing
 * cluster centroid if similarity > threshold; otherwise start a new cluster.
 * O(n × clusters) — fast enough for hundreds of feedback items.
 */
export function clusterFeedback(
  feedback: FeedbackItem[],
  embeddings: Map<string, number[]>,
  threshold = 0.82
): { clusters: FeedbackCluster[]; clusterMap: Map<string, string> } {
  const clusters: FeedbackCluster[] = [];
  const centroids: number[][] = [];
  const clusterMap = new Map<string, string>(); // feedbackId → clusterId

  for (const item of feedback) {
    const emb = embeddings.get(item.id);
    if (!emb?.length) {
      // No embedding — singleton cluster
      const cid = `cluster-${item.id}`;
      clusters.push({ id: cid, representativeId: item.id, memberIds: [item.id], size: 1 });
      clusterMap.set(item.id, cid);
      continue;
    }

    let bestIdx = -1;
    let bestSim = threshold;
    for (let i = 0; i < centroids.length; i++) {
      const sim = cosineSim(emb, centroids[i]);
      if (sim > bestSim) { bestSim = sim; bestIdx = i; }
    }

    if (bestIdx >= 0) {
      const cluster = clusters[bestIdx];
      cluster.memberIds.push(item.id);
      cluster.size++;
      // Update centroid as running mean
      const n = cluster.size;
      centroids[bestIdx] = centroids[bestIdx].map((v, i) => (v * (n - 1) + emb[i]) / n);
      clusterMap.set(item.id, cluster.id);
    } else {
      const cid = `cluster-${item.id}`;
      clusters.push({ id: cid, representativeId: item.id, memberIds: [item.id], size: 1 });
      centroids.push([...emb]);
      clusterMap.set(item.id, cid);
    }
  }

  return { clusters, clusterMap };
}

/**
 * Annotates feedback items with cluster metadata (clusterId, clusterSize).
 * Items in a cluster of size > 1 get a clusterSize metadata field so the
 * agent context and insights generator can report "N customers said X".
 */
export function annotateClusters(
  feedback: FeedbackItem[],
  clusterMap: Map<string, string>,
  clusters: FeedbackCluster[]
): FeedbackItem[] {
  const clusterById = new Map(clusters.map((c) => [c.id, c]));
  return feedback.map((f) => {
    const cid = clusterMap.get(f.id);
    if (!cid) return f;
    const cluster = clusterById.get(cid);
    if (!cluster || cluster.size <= 1) return f;
    return {
      ...f,
      metadata: {
        ...f.metadata,
        clusterId: cid,
        clusterSize: String(cluster.size),
        isClusterRepresentative: f.id === cluster.representativeId ? "true" : "false",
      },
    };
  });
}
