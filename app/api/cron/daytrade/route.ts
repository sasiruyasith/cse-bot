// app/api/cron/daytrade/route.ts
import dayjs from "dayjs";

function asText(x: any) { return typeof x === "string" ? x : JSON.stringify(x); }
async function j<T>(path: string): Promise<T> {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const r = await fetch(`${base}${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json();
}
async function send(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // plain text (no Markdown) so we avoid escaping issues
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}: ${await r.text()}`);
}

export async function GET() {
  try {
    const [{ movers }, news] = await Promise.all([
      j<{ movers: Array<{ symbol: string; pct: number; volume?: number; turnover?: number; lowFloat?: boolean }> }>("/api/cse-movers"),
      j<Array<{ ticker?: string; title: string; source: string; url?: string; date: string }>>("/api/cse-news").catch(() => [])
    ]);

    // Keep movers that are: low-float AND (high volume or big %)
    // You can tweak thresholds via env if you want later
    const MIN_VOL = Number(process.env.DAYTRADE_MIN_VOL || 100_000); // example volume threshold
    const MIN_PCT = Number(process.env.DAYTRADE_MIN_PCT || 3);       // example % change threshold

    const filtered = movers
      .filter(m => m.lowFloat && ((m.volume ?? 0) >= MIN_VOL || m.pct >= MIN_PCT))
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0) || b.pct - a.pct)
      .slice(0, 5);

    // Fallback: if too few low-float entries, still show best 3 movers by volume/% (helps you not miss action)
    const top = filtered.length >= 3 ? filtered
      : movers.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0) || b.pct - a.pct).slice(0, 3);

    const lines = top.map((m, i) => {
      const tag = [
        `+${m.pct.toFixed(1)}%`,
        m.volume ? `Vol ${m.volume.toLocaleString()}` : "",
        m.turnover ? `TO LKR ${Math.round(m.turnover).toLocaleString()}` : "",
        m.lowFloat ? "Low float" : ""
      ].filter(Boolean).join(" · ");

      const rel = news.find(n => n.ticker === m.symbol);
      const extra = rel ? `\n${rel.title} — ${rel.source}${rel.url ? `\n${rel.url}` : ""}` : "";
      return `${i + 1}. ${m.symbol} | ${tag}${extra}`;
    });

    const body =
      `CSE Day-Trade Movers — ${dayjs().format("ddd, MMM D, HH:mm")} (Asia/Colombo)\n` +
      `(Top gainers / highest volume / low float)\n\n` +
      (lines.length ? lines.join("\n\n") : "No qualifying movers yet. Rechecking soon.");

    const ids = (process.env.TELEGRAM_CHAT_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
    if (!ids.length) throw new Error("No TELEGRAM_CHAT_IDS set");
    await Promise.all(ids.map(id => send(id, body)));
    return Response.json({ ok: true, sent: ids.length, mode: "daytrade", items: top.length });
  } catch (e: any) {
    return new Response(asText(e?.message || e), { status: 500 });
  }
}
