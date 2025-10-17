// app/api/cron/daytrade/route.ts
import dayjs from "dayjs";

/** ============== Helpers ============== */
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
    // Keeping plain text to avoid Markdown escaping issues
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}: ${await r.text()}`);
}

/** ============== Scoring logic ==============
 * We compute a composite "tradeScore" so your top list is always useful:
 *   - pct change rank (40%)
 *   - volume rank (40%)
 *   - low-float bonus (+10 if true)
 *   - fresh news bonus (+10 if a headline exists for the symbol)
 *   - turnover rank (10%) for extra liquidity signal
 */
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

/** ============== Handler ============== */
export async function GET() {
  try {
    // 1) Pull movers and (optional) news
    const [{ movers }, news] = await Promise.all([
      j<{ movers: Array<{ symbol: string; pct: number; volume?: number; turnover?: number; lowFloat?: boolean }> }>("/api/cse-movers"),
      j<Array<{ ticker?: string; title: string; source: string; url?: string; date: string }>>("/api/cse-news").catch(() => []),
    ]);

    // thresholds (you can tune in Vercel → Env Vars)
    const MIN_VOL = Number(process.env.DAYTRADE_MIN_VOL || 100_000);
    const MIN_PCT = Number(process.env.DAYTRADE_MIN_PCT || 3);

    // 2) PRIMARY shortlist: low-float + (vol or pct)
    let shortlist = movers
      .filter((m) => m.lowFloat && ((m.volume ?? 0) >= MIN_VOL || m.pct >= MIN_PCT));

    // 3) FALLBACK #1: If <3, relax low-float requirement
    if (shortlist.length < 3) {
      shortlist = movers.filter((m) => (m.volume ?? 0) >= MIN_VOL || m.pct >= MIN_PCT);
    }
    // 4) FALLBACK #2: If <3, just use top turnover names
    if (shortlist.length < 3) {
      shortlist = [...movers].sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0)).slice(0, 8);
    }

    // limit to a reasonable pool for ranking
    const pool = shortlist.slice(0, 12);
    const total = pool.length || 1;

    // ranks
    const rPct = rankify(pool, (x) => x.pct ?? 0);
    const rVol = rankify(pool, (x) => x.volume ?? 0);
    const rTo  = rankify(pool, (x) => x.turnover ?? 0);

    // create a quick news lookup
    const hasNews = new Set(
      news.filter((n) => n.ticker).map((n) => n.ticker as string)
    );

    // 5) SCORE
    const scored = pool.map((m) => {
      const pctScore = normalizeScore(rPct.get(m) || total, total) * 0.40;
      const volScore = normalizeScore(rVol.get(m) || total, total) * 0.40;
      const toScore  = normalizeScore(rTo.get(m)  || total, total) * 0.10;
      const newsBonus = hasNews.has(m.symbol) ? 0.10 : 0;
      const floatBonus = m.lowFloat ? 0.10 : 0;

      const tradeScore = pctScore + volScore + toScore + newsBonus + floatBonus; // 0..1
      return { ...m, tradeScore, news: hasNews.has(m.symbol) };
    });

    // 6) Pick top 5 (always at least 3)
    let top = scored.sort((a, b) => b.tradeScore - a.tradeScore).slice(0, 5);
    if (top.length < 3) {
      top = [...scored].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0) || b.pct - a.pct).slice(0, 3);
    }

    // 7) Build message
    const lines = top.map((m, i) => {
      const tags = [
        `+${m.pct.toFixed(1)}%`,
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
      `(Ranked by price + volume + liquidity, with bonuses for low float & news)\n\n` +
      (lines.length ? lines.join("\n\n") : "No data — rechecking shortly.");

    // 8) Send
    const chatIds = (process.env.TELEGRAM_CHAT_IDS || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (!chatIds.length) throw new Error("No TELEGRAM_CHAT_IDS set");

    await Promise.all(chatIds.map((id) => send(id, body)));
    return Response.json({ ok: true, sent: chatIds.length, items: top.length, ts: new Date().toISOString() });
  } catch (e: any) {
    return new Response(e?.message || "Unknown error", { status: 500 });
  }
}
