// app/api/cron/daytrade/route.ts
import dayjs from "dayjs";

/** ===== helpers ===== */
function getBase() {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
async function j<T>(path: string): Promise<T> {
  const r = await fetch(`${getBase()}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json();
}
async function send(chatId: string, text: string) {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}: ${await r.text()}`);
}

/** ===== scoring ===== */
function rankify<T>(arr: T[], getValue: (x: T) => number): Map<T, number> {
  const sorted = [...arr].sort((a, b) => getValue(b) - getValue(a));
  const map = new Map<T, number>();
  sorted.forEach((item, i) => map.set(item, i + 1)); // 1 = best
  return map;
}
function normalizeScore(rank: number, total: number) {
  if (total <= 1) return 1;
  return 1 - (rank - 1) / (total - 1); // 1..0
}

/** ===== handler ===== */
export async function GET() {
  try {
    // pull movers + news; tolerate news failure
    const [{ movers }, news] = await Promise.all([
      j<{ movers: Array<{ symbol: string; pct: number; volume?: number; turnover?: number; lowFloat?: boolean }> }>("/api/cse-movers")
        .catch(() => ({ movers: [] as any[] })),
      j<Array<{ ticker?: string; title: string; source: string; url?: string; date: string }>>("/api/cse-news")
        .catch(() => []),
    ]);

    // if movers is totally empty, build a fallback pool from your watchlist + news tickers
    let poolBase = movers;
    const WATCH = (process.env.WATCHLIST || "LOLC.N,HAYL.N,COMB.N,JKH.N")
      .split(",").map(s => s.trim()).filter(Boolean);

    if (!poolBase || poolBase.length === 0) {
      // Create synthetic movers from watchlist (so you never get an empty message)
      const tickersFromNews = Array.from(new Set(news.map(n => n.ticker).filter(Boolean))) as string[];
      const seed = Array.from(new Set([...WATCH, ...tickersFromNews])).slice(0, 8);
      poolBase = seed.map(sym => ({ symbol: sym, pct: 0, volume: 0, turnover: 0, lowFloat: false }));
    }

    // thresholds (tunable via env)
    const MIN_VOL = Number(process.env.DAYTRADE_MIN_VOL || 100_000);
    const MIN_PCT = Number(process.env.DAYTRADE_MIN_PCT || 3);

    // primary shortlist
    let shortlist = poolBase.filter(m => m.lowFloat && ((m.volume ?? 0) >= MIN_VOL || m.pct >= MIN_PCT));

    // fallback #1
    if (shortlist.length < 3) {
      shortlist = poolBase.filter(m => (m.volume ?? 0) >= MIN_VOL || m.pct >= MIN_PCT);
    }
    // fallback #2
    if (shortlist.length < 3) {
      shortlist = [...poolBase].sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0)).slice(0, 8);
    }

    const pool = shortlist.slice(0, 12);
    const total = pool.length || 1;

    const rPct = rankify(pool, x => x.pct ?? 0);
    const rVol = rankify(pool, x => x.volume ?? 0);
    const rTo  = rankify(pool, x => x.turnover ?? 0);

    const newsTickers = new Set(news.filter(n => n.ticker).map(n => n.ticker as string));

    const scored = pool.map(m => {
      const pctScore  = normalizeScore(rPct.get(m) || total, total) * 0.40;
      const volScore  = normalizeScore(rVol.get(m) || total, total) * 0.40;
      const toScore   = normalizeScore(rTo.get(m)  || total, total) * 0.10;
      const newsBonus  = newsTickers.has(m.symbol) ? 0.10 : 0;
      const floatBonus = m.lowFloat ? 0.10 : 0;
      const tradeScore = pctScore + volScore + toScore + newsBonus + floatBonus;
      return { ...m, tradeScore, news: newsTickers.has(m.symbol) };
    });

    let top = scored.sort((a, b) => b.tradeScore - a.tradeScore).slice(0, 5);
    if (top.length < 3) {
      top = [...scored].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0) || b.pct - a.pct).slice(0, 3);
    }

    const lines = top.map((m, i) => {
      const tags = [
        `+${(m.pct ?? 0).toFixed(1)}%`,
        m.volume ? `Vol ${m.volume.toLocaleString()}` : "",
        m.turnover ? `TO LKR ${Math.round(m.turnover).toLocaleString()}` : "",
        m.lowFloat ? "Low float" : "",
        m.news ? "News" : "",
        `Score ${(m.tradeScore * 100).toFixed(0)}/100`,
      ].filter(Boolean).join(" · ");
      return `${i + 1}. ${m.symbol} | ${tags}`;
    });

    const body =
      `CSE Day-Trade Movers — ${dayjs().format("ddd, MMM D, HH:mm")} (Asia/Colombo)\n` +
      `(Ranked by price + volume + liquidity, bonuses for low float & news; with guaranteed fallback)\n\n` +
      (lines.length ? lines.join("\n\n") : "No data — rechecking shortly.");

    const chatIds = (process.env.TELEGRAM_CHAT_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
    if (!chatIds.length) throw new Error("No TELEGRAM_CHAT_IDS set");
    await Promise.all(chatIds.map(id => send(id, body)));

    return Response.json({ ok: true, sent: chatIds.length, items: top.length, ts: new Date().toISOString() });
  } catch (e: any) {
    return new Response(e?.message || "Unknown error", { status: 500 });
  }
}
