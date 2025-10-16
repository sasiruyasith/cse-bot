// app/api/cron/cse-telegram/route.ts
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
    // No parse_mode to avoid Markdown issues
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}: ${await r.text()}`);
}

export async function GET() {
  try {
    // movers + news (news optional; if you haven't added /api/cse-news yet, this will still work)
    const [moversData, news] = await Promise.allSettled([
      j<{ movers: Array<{ symbol: string; pct: number; volume?: number; lowFloat?: boolean }> }>("/api/cse-movers"),
      j<Array<{ ticker?: string; title: string; source: string; url?: string; date: string }>>("/api/cse-news")
    ]);

    const movers = moversData.status === "fulfilled" ? moversData.value.movers : [];
    const newsArr = news.status === "fulfilled" ? news.value : [];

    // keep only low-float; rank by volume then %; take top 5 (min 3)
    const picked = movers
      .filter(m => m.lowFloat)
      .sort((a,b) => (b.volume ?? 0) - (a.volume ?? 0) || b.pct - a.pct)
      .slice(0, 5);

    const top = picked.length >= 3 ? picked : movers.slice(0, 3); // fallback if few low-float found

    const lines = top.map((m, i) => {
      const tag = [ `+${m.pct.toFixed(1)}%`, m.volume ? `Vol ${m.volume.toLocaleString()}` : "", m.lowFloat ? "Low float" : "" ]
        .filter(Boolean).join(" · ");
      const rel = newsArr.find(n => n.ticker === m.symbol);
      const extra = rel ? `\n${rel.title} — ${rel.source}${rel.url ? `\n${rel.url}` : ""}` : "";
      return `${i+1}. ${m.symbol} | ${tag}${extra}`;
    });

    const body =
      `CSE Low-Float High-Volume Movers — ${dayjs().format("ddd, MMM D HH:mm")}\n\n` +
      (lines.length ? lines.join("\n\n") : "No qualifying low-float high-volume movers yet. Rechecking soon.");

    const ids = (process.env.TELEGRAM_CHAT_IDS || "").split(",").map(s=>s.trim()).filter(Boolean);
    if (!ids.length) throw new Error("No TELEGRAM_CHAT_IDS set");

    await Promise.all(ids.map(id => send(id, body)));
    return Response.json({ ok: true, sent: ids.length, items: top.length });
  } catch (e:any) {
    return new Response(asText(e?.message || e), { status: 500 });
  }
}
