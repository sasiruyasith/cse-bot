import * as cheerio from "cheerio";
import { getFloatForCseSymbol } from "@/lib/float-provider";

export const revalidate = 0;

type Mover = {
  symbol: string; pct: number; price?: number; volume?: number; turnover?: number;
  lowFloat?: boolean; floatShares?: number; sharesOutstanding?: number;
};

function normalize(sym: string) { return sym.replace(/\.N\d{4}$/i, ".N"); }

async function fetchGainers(): Promise<Mover[]> {
  const res = await fetch("https://www.cse.lk/pages/percentage-gainers/percentage-gainers.component.html", { next: { revalidate: 0 } });
  if (!res.ok) throw new Error("CSE gainers fetch failed");
  const $ = cheerio.load(await res.text()); const out: Mover[] = [];
  $("table tbody tr").each((_, tr) => {
    const t = $(tr).find("td");
    const symbol = $(t[0]).text().trim();
    const price  = parseFloat($(t[1]).text().replace(/,/g,""));
    const pct    = parseFloat($(t[3]).text().replace(/%/g,"").trim());
    const volume = parseInt($(t[4]).text().replace(/,/g,""),10);
    const turnover = parseFloat($(t[5]).text().replace(/,/g,""));
    if (symbol && !Number.isNaN(pct)) out.push({ symbol, pct, price, volume, turnover });
  });
  return out.slice(0, 20);
}

async function fetchActive(): Promise<Mover[]> {
  const res = await fetch("https://www.cse.lk/pages/most-active-volumes/most-active-volumes.component.html", { next: { revalidate: 0 } });
  if (!res.ok) throw new Error("CSE volumes fetch failed");
  const $ = cheerio.load(await res.text()); const out: Mover[] = [];
  $("table tbody tr").each((_, tr) => {
    const t = $(tr).find("td");
    const symbol = $(t[0]).text().trim();
    const price  = parseFloat($(t[1]).text().replace(/,/g,""));
    const pct    = parseFloat($(t[3]).text().replace(/%/g,"").trim());
    const volume = parseInt($(t[4]).text().replace(/,/g,""),10);
    const turnover = parseFloat($(t[5]).text().replace(/,/g,""));
    if (symbol) out.push({ symbol, pct: Number.isNaN(pct) ? 0 : pct, price, volume, turnover });
  });
  return out.slice(0, 30);
}

export async function GET() {
  try {
    const [gainers, active] = await Promise.all([fetchGainers().catch(()=>[]), fetchActive().catch(()=>[])]);
    // merge
    const map = new Map<string, Mover>();
    for (const m of [...gainers, ...active]) {
      const key = normalize(m.symbol);
      const cur = map.get(key);
      map.set(key, {
        symbol: key,
        pct: Math.max(m.pct ?? 0, cur?.pct ?? 0),
        price: m.price ?? cur?.price,
        volume: m.volume ?? cur?.volume,
        turnover: m.turnover ?? cur?.turnover
      });
    }
    let movers = Array.from(map.values())
      .sort((a,b) => (b.volume ?? 0) - (a.volume ?? 0) || b.pct - a.pct);

    // fetch float for top ~25
    const top = movers.slice(0, 25);
    const floats = await Promise.all(top.map(m => getFloatForCseSymbol(m.symbol)));
    const fMap = new Map<string, { floatShares?: number; sharesOutstanding?: number }>();
    top.forEach((m,i)=>fMap.set(m.symbol, { floatShares: floats[i]?.floatShares, sharesOutstanding: floats[i]?.sharesOutstanding }));

    movers = movers.map(m => {
      const f = fMap.get(m.symbol);
      if (!f) return m;
      const { floatShares, sharesOutstanding } = f;
      let low = false;
      if (floatShares && floatShares < 40_000_000) low = true;
      if (floatShares && sharesOutstanding && floatShares/sharesOutstanding < 0.25) low = true;
      return { ...m, lowFloat: low, floatShares, sharesOutstanding };
    });

    return Response.json({ movers, timestamp: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e:any) {
    console.error(e); return new Response(e.message, { status: 500 });
  }
}
