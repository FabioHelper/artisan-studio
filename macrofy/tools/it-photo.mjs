// The real, openly licensed test photo of the integration test (T-017): a plate of food from Wikimedia Commons, fetched at CI time
// (the runner has internet, the agent sandbox does not). tools/it-photo.json is the pin: title, licence and sha256 of the file.
//   - Pinned (sha256 set): the file is fetched by title, its licence must still be an open one and its bytes must hash to the pinned sha256;
//     any difference is a FAILURE (the photo is not silently replaced), and the photo assertions are hard.
//   - Unpinned (sha256 null, the state until someone has looked at a candidate): the search in the pin file picks the first open-licensed JPEG
//     (by title), the run prints its title, URL, licence and sha256 as a warning to paste into the pin file, and the photo assertions only warn.
// Pure apart from the injected `fetchImpl`, so web/selftest.mjs exercises it with a fake Commons.
import { createHash } from 'node:crypto';

export const UA = 'macrofy-model-it/1.0 (https://github.com/FabioHelper/artisan-studio; CI test photo)'; // Wikimedia asks for a descriptive agent
export const API = 'https://commons.wikimedia.org/w/api.php';
/** Open licences only: CC0, public domain, CC BY and CC BY-SA (any version); never NonCommercial or NoDerivatives. */
export const licenseAllowed = (name) => typeof name === 'string' && /^(CC0|Public domain|PD\b|CC BY(-SA)? \d)/i.test(name.trim()) && !/-NC|-ND|non-?commercial|no-?derivatives/i.test(name);
const strip = (html) => String(html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/** The Commons API URL that returns the file info (url, mime, size, licence, author): by title when the pin has one, else a search. */
export function commonsQuery(cfg) {
  const p = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist' });
  if (cfg.title) p.set('titles', cfg.title);
  else { p.set('generator', 'search'); p.set('gsrsearch', `${cfg.search} filetype:bitmap`); p.set('gsrnamespace', '6'); p.set('gsrlimit', '30'); }
  return `${API}?${p}`;
}
/** From the API JSON: the first (by title) open-licensed JPEG at least `minWidth` wide, or null. -> { title, url, license, author, width, height } */
export function pickCommonsPhoto(json, { minWidth = 800 } = {}) {
  const pages = Object.values(json?.query?.pages ?? {}).filter((pg) => pg.imageinfo?.[0]).sort((a, b) => String(a.title).localeCompare(String(b.title)));
  for (const pg of pages) {
    const i = pg.imageinfo[0]; const license = i.extmetadata?.LicenseShortName?.value;
    if (i.mime === 'image/jpeg' && i.width >= minWidth && licenseAllowed(license)) return { title: pg.title, url: i.url, license, author: strip(i.extmetadata?.Artist?.value), width: i.width, height: i.height };
  }
  return null;
}
/**
 * Resolves and downloads the photo. -> { title, url, license, author, sha256, pinned, bytes, pin } where `pin` is the JSON to paste into the pin file.
 * Throws when nothing usable is found, the licence is not open, or (pinned) the sha256 changed (`hashChanged: true`).
 */
export async function resolvePhoto(cfg, { fetchImpl = fetch } = {}) {
  const get = async (url) => { const r = await fetchImpl(url, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r; };
  const info = pickCommonsPhoto(await (await get(commonsQuery(cfg))).json(), { minWidth: cfg.min_width ?? 800 });
  if (!info) throw new Error(cfg.title ? `${cfg.title}: not found on Commons, not a JPEG, too small or no longer under an open licence` : `no open-licensed JPEG found for "${cfg.search}"`);
  const bytes = Buffer.from(await (await get(info.url)).arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex'); const pinned = typeof cfg.sha256 === 'string' && cfg.sha256.length === 64;
  if (pinned && sha256 !== cfg.sha256) throw Object.assign(new Error(`the photo ${info.title} changed: sha256 is ${sha256}, the pin says ${cfg.sha256}`), { hashChanged: true });
  return { ...info, sha256, pinned, bytes, pin: { title: info.title, url: info.url, license: info.license, author: info.author, sha256 } };
}
