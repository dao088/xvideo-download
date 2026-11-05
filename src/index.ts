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

export type Resolutions = Record<string, string>;

// 1) Lee las URLs que aparecen directo en el script de la página
export function parsePlayerUrls(html: string) {
  const grab = (name: string) =>
    html.match(new RegExp(`setVideo${name}\\(\\s*['"]([^'"]+)['"]\\s*\\)`))?.[1] ?? null;

  return {
    low: grab("UrlLow"),
    high: grab("UrlHigh"),
    hls: grab("HLS"),
  };
}

// 2) Lee la lista maestra HLS y devuelve una URL por calidad
export function parseHlsMaster(m3u8: string, masterUrl: string): Resolutions {
  const out: Resolutions = {};
  const lines = m3u8.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;

    const height = line.match(/RESOLUTION=\d+x(\d+)/)?.[1];
    const next = lines[i + 1]?.trim();
    if (!height || !next) continue;

    // las URLs de la lista suelen ser relativas: se resuelven contra la maestra
    out[`hls-${height}p`] = new URL(next, masterUrl).href;
  }
  return out;
}

// 3) Junta todo
export async function getResolutions(html: string): Promise<Resolutions> {
  const { low, high, hls } = parsePlayerUrls(html);
  const resolutions: Resolutions = {};

  if (low) resolutions["mp4-low"] = low;
  if (high) resolutions["mp4-high"] = high;

  if (hls) {
    const res = await fetch(hls, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    if (res.ok) {
      Object.assign(resolutions, parseHlsMaster(await res.text(), hls));
    }
  }
  return resolutions;
}
