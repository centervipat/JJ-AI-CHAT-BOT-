const CACHE_TTL_MS = 60_000;

let cachedCsv: string | null = null;
let cachedAt = 0;

export async function getFaqCsv(): Promise<string> {
  const now = Date.now();

  if (cachedCsv !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedCsv;
  }

  const url = process.env.SHEET_CSV_URL;
  if (!url) {
    throw new Error("SHEET_CSV_URL is not set");
  }

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Sheet fetch failed with status ${res.status}`);
    }
    const csv = await res.text();
    cachedCsv = csv;
    cachedAt = now;
    return csv;
  } catch (err) {
    if (cachedCsv !== null) {
      console.error("getFaqCsv: fetch failed, serving stale cache", err);
      return cachedCsv;
    }
    throw err;
  }
}
