// app/api/cron/swing/route.ts
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
    // You can also set WATCHLIST via env: "LOLC.N,HAYL.N,COMB.N,JKH.N"
    const WATCHLIST = (process.env.WATCHLIST || "LOLC.N,HAYL.N,COMB.N,JKH.N")
      .split(",").map(s => s.trim()).filter(Boolean);

    const news = await j<Array<{ ticker?: string; title: string; source: string; url?: string; date: string }>>("/api/cse-news");
    // score watchlist headlines and take top 5–6
    const picked = news
      .map(n => ({
        n, score:
          (n.ticker && WATCHLIST.includes(n.ticker) ? 10 : 0) +
          (Date.now() - new Date(n.date).getTime() < 6 * 3600e3 ? 3 : 0)
      }))
      .sort((a, b) => b.score - a.score)
      .map(x => x.n)
      .slice(0, 6);

    const lines = picked.map((it, idx) => {
      const ts = dayjs(it.date).format("MMM D, HH:mm");
      const tkr = it.ticker ? ` ${it.ticker}` : "";
      const url = it.url ? `\n${it.url}` : "";
      return `${idx + 1}. ${it.title}${tkr}\n${ts} · ${it.source}${url}`;
    });

    const body =
      `CSE Swing Watch — ${dayjs().format("ddd, MMM D, HH:mm")} (Asia/Colombo)\n\n` +
      (lines.length ? lines.join("\n\n") : "No fresh headlines for your swing watchlist yet.");

    const ids = (process.env.TELEGRAM_CHAT_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
    if (!ids.length) throw new Error("No TELEGRAM_CHAT_IDS set");
    await Promise.all(ids.map(id => send(id, body)));
    return Response.json({ ok: true, sent: ids.length, mode: "swing", items: picked.length });
  } catch (e: any) {
    return new Response(asText(e?.message || e), { status: 500 });
  }
}
