import * as cheerio from "cheerio";

export interface VideoInfo {
  title: string | null;
  thumbnail: string | null;
  description: string | null;
  jsonLd: unknown | null;
}

export function parseVideo(html: string): VideoInfo {
  const $ = cheerio.load(html);
  const meta = (p: string) => $(`meta[property="${p}"]`).attr("content") ?? null;

  let jsonLd: unknown = null;
  try {
    const raw = $('script[type="application/ld+json"]').first().html();
    if (raw) jsonLd = JSON.parse(raw);
  } catch {}

  return {
    title: meta("og:title") ?? $("title").text() ?? null,
    thumbnail: meta("og:image"),
    description: meta("og:description"),
    jsonLd,
  };
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return parseVideo(await res.text());
}