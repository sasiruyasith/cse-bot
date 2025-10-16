// lib/float-provider.ts
type FloatInfo = { floatShares?: number; sharesOutstanding?: number; source?: string };

const YF = "https://query1.finance.yahoo.com/v10/finance/quoteSummary";

// Try a few Yahoo symbol patterns
const ATTEMPT_FORMATS = (base: string) => [`${base}.CO`, `${base}.CM`, base];

function toYahooCandidates(cseSymbol: string): string[] {
  const root = cseSymbol.replace(/\.N\d{4}$/i, ".N").replace(/\.N$/i, "");
  return [...ATTEMPT_FORMATS(cseSymbol), ...ATTEMPT_FORMATS(root)];
}

async function fetchYF(symbol: string): Promise<FloatInfo | null> {
  const url = `${YF}/${encodeURIComponent(symbol)}?modules=defaultKeyStatistics%2Cprice`;
  const r = await fetch(url, { headers: { "User-Agent": "cse-movers/1.0" }, cache: "no-store" });
  if (!r.ok) return null;
  const j = await r.json();
  const ks = j?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
  const floatShares = ks?.floatShares?.raw ?? ks?.floatShares;
  const sharesOutstanding = ks?.sharesOutstanding?.raw ?? ks?.sharesOutstanding;
  if (!floatShares && !sharesOutstanding) return null;
  return { floatShares: floatShares || undefined, sharesOutstanding: sharesOutstanding || undefined, source: symbol };
}

// 6h in-memory cache
const cache = new Map<string, { when: number; v: FloatInfo | null }>();
const TTL = 6 * 60 * 60 * 1000;

export async function getFloatForCseSymbol(cseSymbol: string): Promise<FloatInfo | null> {
  const now = Date.now();
  const c = cache.get(cseSymbol);
  if (c && now - c.when < TTL) return c.v;

  for (const cand of toYahooCandidates(cseSymbol)) {
    try {
      const v = await fetchYF(cand);
      if (v) { cache.set(cseSymbol, { when: now, v }); return v; }
    } catch {}
  }
  cache.set(cseSymbol, { when: now, v: null });
  return null;
}
