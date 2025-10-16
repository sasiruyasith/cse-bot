// /app/api/telegram/send/route.ts
import { NextRequest } from "next/server";

const TELEGRAM_API = "https://api.telegram.org";

async function sendTelegramMessage(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN env var");

  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // NOTE: no parse_mode yet to avoid Markdown escaping issues
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });

  if (!res.ok) {
    const errText = await res.text(); // show Telegram's real error
    throw new Error(`Telegram ${res.status}: ${errText}`);
  }
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const { chatId, text } = await req.json();
    if (!chatId || !text) {
      return new Response('Missing chatId/text. Example body: {"chatId":"123","text":"hi"}', { status: 400 });
    }
    const data = await sendTelegramMessage(chatId, text);
    return Response.json({ ok: true, data });
  } catch (e: any) {
    // return readable error text (not JSON.parse-able by default)
    return new Response(e?.message || "Unknown error", { status: 500 });
  }
}

// Optional: so opening the URL in a browser shows instructions not 405
export async function GET() {
  return new Response('Use POST with JSON body: {"chatId":"...","text":"..."}', { status: 200 });
}
