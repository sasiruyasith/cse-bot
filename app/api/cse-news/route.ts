// app/api/cse-news/route.ts
import Parser from "rss-parser";

export const revalidate = 0; // no ISR caching

type NewsItem = {
  id: string;
  title: string;
  url?: string;
  date: string;   // ISO string
  source: string;
  summary?: string;
  ticker?: string;
};

const parser = new Parser({
  headers: {
    // Some feeds block default serverless agents; use a browser-y UA
    "User-Agent": "CSE-Bot/1.0 (+https://example.com)"
  }
});

// Feel free to extend this list later
const FEEDS: Array<{ source: string; url: string }> = [
  { source: "CSE Announcements", url: "https://www.cse.lk/api/announcements/rss" },
  { source: "Daily FT",          url: "https://www.ft.lk/rssfeed" },
  { source: "EconomyNext",       url: "https://economynext.com/feed/" },
  { source: "NewsWire Business", url: "https://www.newswire.lk/category/business/feed/" }
];

// crude ticker detection; customize as you like
const TICKER_HINTS: Record<string, string[]> = {
  "LOLC.N": ["LOLC", "Lanka Orix"],
  "HAYL.N": ["Hayleys", "Hayleys PLC"],
  "COMB.N": ["Commercial Bank", "ComBank", "COMB"],
  "JKH.N":  ["John Keells", "JKH"]
};

function guessTicker(title = "", summary = ""): string | undefined {
  const haystack = `${title} ${summary}`.toLowerCase();
  for (const [ticker, hints] of Object.entries(TICKER_HINTS)) {
    if (hints.some(h => haystack.includes(h.toLowerCase()))) return ticker;
  }
  return undefined;
}

export async function GET() {
  const items: NewsItem[] = [];

  await Promise.all(
    FEEDS.map(async ({ source, url }) => {
      try {
        const feed = await parser.parseURL(url);
        for (const it of (feed.items || []).slice(0, 20)) {
          const title = it.title ?? "";
          const link = it.link ?? undefined;
          const iso =
            it.isoDate
              ? new Date(it.isoDate).toISOString()
              : it.pubDate
                ? new Date(it.pubDate).toISOString()
                : new Date().toISOString();

          // strip HTML if present
          const raw = (it.contentSnippet || it.content || "") as string;
          const summary = raw.replace(/<[^>]+>/g, "");

          items.push({
            id: `${source}-${link ?? title}-${iso}`,
            title,
            url: link,
            date: iso,
            source,
            summary,
            ticker: guessTicker(title, summary)
          });
        }
      } catch (e) {
        // Don’t break the endpoint if one feed fails
        console.error("Feed error:", source, e);
      }
    })
  );

  // newest first
  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return new Response(JSON.stringify(items.slice(0, 120)), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
