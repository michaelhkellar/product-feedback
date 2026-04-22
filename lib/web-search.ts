export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  domain: string;
}

export async function searchWeb(query: string, key: string, count = 3): Promise<WebSearchResult[]> {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(Math.max(count, 1), 5)}`;
    const res = await fetch(url, {
      headers: {
        "X-Subscription-Token": key,
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`Brave Search error: ${res.status}`);
      return [];
    }
    const data = await res.json() as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return (data.web?.results ?? []).map((r) => {
      const rawUrl = r.url ?? "";
      let domain = "";
      try { domain = new URL(rawUrl).hostname; } catch { domain = rawUrl; }
      return {
        title: r.title ?? "",
        url: rawUrl,
        description: r.description ?? "",
        domain,
      };
    }).filter((r) => r.url);
  } catch (err) {
    console.error("Brave Search failed:", err);
    return [];
  }
}
