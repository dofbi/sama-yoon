#!/usr/bin/env node
// Fetches every public source used to build the Sama Yoon datasets, stores the
// raw payload under data/raw/<source>/<YYYY-MM-DD>.<ext>, and records
// fetched_at / sha256 / HTTP validators in data/raw/manifest.json.
// Parsed results land in data/scraped/*.json and feed scripts/build-data.mjs.
//
// Usage: node scripts/scrape-sources.mjs [--only=id1,id2]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parse as parseHtml } from 'node-html-parser';
import { recoverNearest } from './lib/olc.mjs';
import { fetchBoard, summarize, AIBD_BASE } from './lib/aibd.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'data/scraped');
const UA = 'SamaYoon/0.1 (+civic mobility app; contact genova@dofbi.com)';
const TICKETS = 'https://tickets.dakar2026.org';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OVERPASS_MIRRORS = ['https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const DAKAR_BBOX = '14.60,-17.55,14.80,-17.05';

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const today = new Date().toISOString().slice(0, 10);
const manifestPath = path.join(RAW, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{"sources":{}}'));

function realLastModified(headers) {
  const lm = Date.parse(headers.get('last-modified') || '');
  const now = Date.parse(headers.get('date') || '') || Date.now();
  return Number.isNaN(lm) || Math.abs(now - lm) < 120_000 ? null : new Date(lm).toISOString();
}

async function fetchRaw(id, url, { ext = 'html', init = {}, mirrors = [] } = {}) {
  let res;
  for (const u of [url, ...mirrors]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(u, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } }).catch((e) => ({ ok: false, status: e.message }));
      if (res.ok || (typeof res.status === 'number' && ![429, 502, 503, 504].includes(res.status))) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (res.ok) break;
  }
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status} for ${url}`);
  const body = await res.text();
  const sha256 = createHash('sha256').update(body).digest('hex');
  const dir = path.join(RAW, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${today}.${ext}`), body);
  const prev = manifest.sources[id];
  manifest.sources[id] = {
    ...prev,
    id,
    url,
    method: 'http-fetch',
    fetched_at: new Date().toISOString(),
    sha256,
    changed_since_last_fetch: prev ? prev.sha256 !== sha256 : null,
    // Dynamic pages send Last-Modified = now; only keep a real modification date.
    http_last_modified: realLastModified(res.headers),
    http_etag: res.headers.get('etag'),
    raw_file: path.relative(ROOT, path.join(dir, `${today}.${ext}`)),
  };
  return body;
}

// Next.js App Router pages stream their props in self.__next_f.push([1,"..."]).
function nextFlight(html) {
  const parts = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)];
  return parts.map((m) => JSON.parse(`"${m[1]}"`)).join('');
}

function extractJsonArray(text, key) {
  const start = text.indexOf(`"${key}":[`);
  if (start < 0) return [];
  let i = text.indexOf('[', start);
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '[') depth++;
    else if (text[j] === ']' && --depth === 0) return JSON.parse(text.slice(i, j + 1));
  }
  return [];
}

const toIso = (s) => {
  // "30.10.2026, 09:00" (Senegal = GMT) -> "2026-10-30T09:00:00Z"
  const m = s?.match(/(\d{2})\.(\d{2})\.(\d{4}), (\d{2}:\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:00Z` : null;
};

const sources = {
  // Official ticketing home: next ticketed sessions with exact times & venues.
  async tickets_sessions() {
    const html = await fetchRaw('tickets_sessions', `${TICKETS}/fr`);
    const flight = nextFlight(html);
    const sessions = extractJsonArray(flight, 'gameInfo').map((g) => ({
      schedule_id: g.scheduleId,
      place_id: g.placeId,
      venue_name: g.placeNameFra || g.placeName,
      discipline: g.homeTeamNameFra || g.homeTeamName,
      session: g.subTitleFra || g.subTitle,
      starts_at: toIso(g.playDateTime_Senegal),
      notice: g.scheduleNoticeFra || null,
    }));
    return { sessions };
  },

  // Official venue guide: names, Plus Codes, disciplines + Google Maps links.
  async tickets_venues() {
    const html = await fetchRaw('tickets_venues', `${TICKETS}/fr/guide/venues`);
    // Text nodes are adjacent without spaces: "1Complexe…Voir planLieuMGWQ+QHG x …DisciplineBaseball5, …Lieu"
    const text = parseHtml(html).text.replace(/\s+/g, ' ');
    const venues = [];
    const segs = text.split('Voir plan');
    for (let k = 1; k < segs.length; k++) {
      const head = segs[k - 1].match(/(\d)([^\d]+)$/);
      const body = segs[k].match(/^Lieu(?:([23456789CFGHJMPQRVWX]{4}\+[23456789CFGHJMPQRVWX]{2,3})[ ,x]*)?(.*?)Discipline(.*?)Lieu/);
      if (!head || !body) continue;
      venues.push({ order: +head[1], name: head[2].trim(), plus_code: body[1] || null, address: body[2].trim(), disciplines: body[3].split(',').map((d) => d.trim()) });
    }
    // Venue codes + Maps short links live in a client chunk (VENUE_INFO).
    const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[\w-]+\.js/g) || [])];
    let info = [];
    for (const c of chunks) {
      const js = await (await fetch(TICKETS + c, { headers: { 'User-Agent': UA } })).text();
      if (!js.includes('VENUE_INFO')) continue;
      info = [...js.matchAll(/\{id:(\d+),code:"([A-Z]+)"[^}]*?url:"([^"]+)"/g)].map((m) => ({ order: +m[1], code: m[2], maps_url: m[3] }));
      break;
    }
    for (const v of venues) {
      const i = info.find((x) => x.order === v.order);
      if (!i) continue;
      v.code = i.code;
      v.maps_url = i.maps_url;
      const r = await fetch(i.maps_url, { redirect: 'manual', headers: { 'User-Agent': UA } });
      const loc = r.headers.get('location') || '';
      const pin = loc.match(/!3d(-?[\d.]+)!4d(-?[\d.]+)/) || loc.match(/search\/(-?[\d.]+),\+?(-?[\d.]+)/);
      if (pin) v.maps_coordinates = { lat: +pin[1], lng: +pin[2] };
    }
    for (const v of venues) {
      if (!v.plus_code) continue;
      const ref = v.maps_coordinates || { lat: 14.7, lng: -17.4 };
      const p = recoverNearest(v.plus_code, ref.lat, ref.lng);
      v.plus_code_coordinates = { lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) };
    }
    return { venues };
  },

  // Day x sport grid (mirrors the official programme released 2026-02-02).
  async wikipedia_calendar() {
    const url = 'https://en.wikipedia.org/w/api.php?action=parse&page=2026_Summer_Youth_Olympics&prop=wikitext%7Crevid&format=json&formatversion=2';
    const body = await fetchRaw('wikipedia_calendar', url, { ext: 'json' });
    const { revid, wikitext } = JSON.parse(body).parse;
    manifest.sources.wikipedia_calendar.source_revision = revid;
    const days = ['2026-10-30', '2026-10-31', ...Array.from({ length: 13 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`)];
    const cal = wikitext.slice(wikitext.indexOf('==Calendar=='));
    const rows = cal.split('<!--Sport-->').slice(1);
    const sports = [];
    for (const row of rows) {
      const name = (row.match(/\[\[[^\]|]*\|([^\]]+)\]\]\s*\n/) || row.match(/\]\]\s*([^\n]+)\n/))?.[1]?.trim();
      const cells = [...row.matchAll(/<!--\s*\d+-->\|(.*)/g)].map((m) => m[1]);
      if (!name || cells.length !== days.length) continue;
      const schedule = {};
      cells.forEach((c, i) => {
        if (/OC/.test(c)) schedule[days[i]] = 'opening_ceremony';
        else if (/CC/.test(c)) schedule[days[i]] = 'closing_ceremony';
        else if (/'''\d+'''/.test(c)) schedule[days[i]] = `medals:${c.match(/'''(\d+)'''/)[1]}`;
        else if (/●/.test(c)) schedule[days[i]] = 'competition';
      });
      const page = row.match(/\[\[([^\]|]*at the 2026 Summer Youth Olympics)\|/)?.[1] || null;
      sports.push({ sport: name, page, schedule });
    }
    const released = cal.match(/schedule was released on ([^.]+)\./)?.[1] || null;
    return { revid, programme_released: released, sports };
  },

  // OSM: TER stations (SETER) and BRT platforms (SunuBRT).
  async osm_transit() {
    const q = `[out:json][timeout:60];(nwr["railway"~"station|halt"]["operator"~"SETER",i](${DAKAR_BBOX});nwr["public_transport"="platform"]["network"~"SunuBRT",i](${DAKAR_BBOX}););out center tags;`;
    const body = await fetchRaw('osm_transit', OVERPASS, { ext: 'json', mirrors: OVERPASS_MIRRORS, init: { method: 'POST', body: new URLSearchParams({ data: q }) } });
    const json = JSON.parse(body);
    manifest.sources.osm_transit.source_updated_at = json.osm3s?.timestamp_osm_base || null;
    const seen = new Set();
    const stations = [];
    for (const e of json.elements) {
      const t = e.tags || {};
      const mode = /SunuBRT/i.test(t.network || '') ? 'BRT' : 'TER';
      const name = (t.name || '').replace(/^Station BRT\s*/i, '').trim();
      if (!name || seen.has(mode + name.toLowerCase())) continue;
      seen.add(mode + name.toLowerCase());
      stations.push({ mode, name, lat: e.lat ?? e.center.lat, lng: e.lon ?? e.center.lon, osm_id: `${e.type}/${e.id}` });
    }
    return { stations };
  },

  // OSM: Route de la Corniche Ouest carriageways (road cycling corridor).
  async osm_corniche() {
    const q = `[out:json][timeout:60];way["highway"]["name"="Route de la Corniche Ouest"](14.66,-17.51,14.73,-17.43);out tags geom;`;
    const body = await fetchRaw('osm_corniche', OVERPASS, { ext: 'json', mirrors: OVERPASS_MIRRORS, init: { method: 'POST', body: new URLSearchParams({ data: q }) } });
    const json = JSON.parse(body);
    manifest.sources.osm_corniche.source_updated_at = json.osm3s?.timestamp_osm_base || null;
    const ways = json.elements.map((e) => ({ id: e.id, oneway: e.tags.oneway === 'yes', path: e.geometry.map((g) => [+g.lat.toFixed(5), +g.lon.toFixed(5)]) }));
    return { ways };
  },

  // OSM: cultural landmarks used as decorative map markers.
  async osm_landmarks() {
    const q = `[out:json][timeout:60];(nwr["name"~"Renaissance africaine|^Grande Mosquée de Dakar|Village artisanal de Soumbédioune|Phare des Mamelles|Mosquée de la Divinité",i](14.64,-17.54,14.76,-17.38););out center tags;`;
    const body = await fetchRaw('osm_landmarks', OVERPASS, { ext: 'json', mirrors: OVERPASS_MIRRORS, init: { method: 'POST', body: new URLSearchParams({ data: q }) } });
    const json = JSON.parse(body);
    manifest.sources.osm_landmarks.source_updated_at = json.osm3s?.timestamp_osm_base || null;
    const seen = new Set();
    const landmarks = json.elements
      .filter((e) => e.tags?.name && !seen.has(e.tags.name) && seen.add(e.tags.name))
      .map((e) => ({ name: e.tags.name, lat: e.lat ?? e.center.lat, lng: e.lon ?? e.center.lon, osm_id: `${e.type}/${e.id}` }));
    return { landmarks };
  },

  // OSM: Youth Olympic Village (UAM social campus), Saly town, Kër Ayo (COJOJ HQ).
  async osm_accommodation() {
    const q = `[out:json][timeout:60];(way["name"~"Campus social de l.universit. Amadou Mahtar",i](14.70,-17.25,14.76,-17.15);node["place"]["name"~"^Saly",i](14.40,-17.05,14.48,-16.95);rel["name"~"^K.r Ayo$",i](14.69,-17.51,14.74,-17.46););out center tags;`;
    const body = await fetchRaw('osm_accommodation', OVERPASS, { ext: 'json', mirrors: OVERPASS_MIRRORS, init: { method: 'POST', body: new URLSearchParams({ data: q }) } });
    const json = JSON.parse(body);
    manifest.sources.osm_accommodation.source_updated_at = json.osm3s?.timestamp_osm_base || null;
    const pts = json.elements.map((e) => ({ name: e.tags.name, place: e.tags.place || null, lat: e.lat ?? e.center.lat, lng: e.lon ?? e.center.lon, osm_id: `${e.type}/${e.id}` }));
    const campus = pts.filter((p) => /amadou mahtar/i.test(p.name));
    const avg = (k) => campus.reduce((s, p) => s + p[k], 0) / campus.length;
    return {
      village: campus.length ? { name: campus[0].name, lat: avg('lat'), lng: avg('lng'), osm_ids: campus.map((p) => p.osm_id) } : null,
      places: pts.filter((p) => !/amadou mahtar/i.test(p.name)),
    };
  },

  // Athletes per sport (Wikipedia sport pages linked from the calendar) to
  // weight delegation arrival/departure waves. Missing pages are reported.
  async wikipedia_quotas() {
    const cal = JSON.parse(await readFile(path.join(OUT, 'wikipedia_calendar.json'), 'utf8'));
    const quotas = [];
    const raw = {};
    for (const { sport, page } of cal.sports) {
      if (!page) continue;
      const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext%7Crevid&format=json&formatversion=2`;
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      const json = res.ok ? await res.json() : {};
      const w = json.parse?.wikitext || '';
      raw[sport] = { page, revid: json.parse?.revid || null, competitors_field: w.match(/\|\s*competitors\s*=\s*([^\n]+)/)?.[1] || null };
      const n = raw[sport].competitors_field?.match(/\d[\d,]*/)?.[0];
      quotas.push({ sport, page, athletes: n ? +n.replace(/,/g, '') : null, revid: raw[sport].revid });
      await new Promise((r) => setTimeout(r, 200));
    }
    const body = JSON.stringify(raw);
    const dir = path.join(RAW, 'wikipedia_quotas');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${today}.json`), body);
    manifest.sources.wikipedia_quotas = {
      ...manifest.sources.wikipedia_quotas,
      id: 'wikipedia_quotas',
      url: 'https://en.wikipedia.org/wiki/2026_Summer_Youth_Olympics',
      method: 'http-fetch',
      fetched_at: new Date().toISOString(),
      sha256: createHash('sha256').update(body).digest('hex'),
      raw_file: path.relative(ROOT, path.join(dir, `${today}.json`)),
    };
    return { quotas };
  },

  // Official AIBD flight board (today only): hourly movement profile used as
  // the airport's typical daily rhythm.
  async aibd_board() {
    const opts = { delayMs: 1000, headers: { 'User-Agent': UA } };
    const arrivals = await fetchBoard('arrivals', opts);
    const departures = await fetchBoard('departures', opts);
    const body = JSON.stringify({ arrivals, departures });
    const dir = path.join(RAW, 'aibd_board');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${today}.json`), body);
    const day = [...arrivals, ...departures].map((r) => r.date).sort().find((d) => d === today) || today;
    manifest.sources.aibd_board = {
      ...manifest.sources.aibd_board,
      id: 'aibd_board',
      url: `${AIBD_BASE}/fr/vols/arrivee-vols`,
      method: 'http-fetch',
      fetched_at: new Date().toISOString(),
      sha256: createHash('sha256').update(body).digest('hex'),
      raw_file: path.relative(ROOT, path.join(dir, `${today}.json`)),
    };
    return { baseline: summarize({ arrivals, departures }, day) };
  },

  // OSM: AIBD aerodrome/terminal and the toll motorway Dakar - Diamniadio - AIBD.
  async osm_aibd() {
    const q = `[out:json][timeout:90];(nwr["aeroway"="aerodrome"]["icao"="GOBD"];nwr["aeroway"="terminal"](14.66,-17.09,14.69,-17.05);way["highway"="motorway"](14.64,-17.45,14.77,-17.05););out tags geom;`;
    const body = await fetchRaw('osm_aibd', OVERPASS, { ext: 'json', mirrors: OVERPASS_MIRRORS, init: { method: 'POST', body: new URLSearchParams({ data: q }) } });
    const json = JSON.parse(body);
    manifest.sources.osm_aibd.source_updated_at = json.osm3s?.timestamp_osm_base || null;
    const centre = (e) => {
      const g = e.geometry || e.members?.flatMap((m) => m.geometry || []) || [];
      if (e.lat) return { lat: e.lat, lng: e.lon };
      return { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lng: g.reduce((s, p) => s + p.lon, 0) / g.length };
    };
    const aerodrome = json.elements.find((e) => e.tags?.aeroway === 'aerodrome');
    const terminal = json.elements.find((e) => e.tags?.aeroway === 'terminal');
    const motorway = json.elements
      .filter((e) => e.tags?.highway === 'motorway')
      .map((e) => ({ id: e.id, name: e.tags.name || null, path: e.geometry.map((g) => [+g.lat.toFixed(5), +g.lon.toFixed(5)]) }));
    return {
      aerodrome: aerodrome ? { name: aerodrome.tags.name, ...centre(aerodrome), osm_id: `${aerodrome.type}/${aerodrome.id}` } : null,
      terminal: terminal ? { name: terminal.tags.name || 'Terminal', ...centre(terminal), osm_id: `${terminal.type}/${terminal.id}` } : null,
      motorway,
    };
  },

  // OSM: neighbourhoods and landmarks named in rain/flood press reports.
  async osm_rain_places() {
    const q = `[out:json][timeout:60];(node["place"]["name"~"^(Mbao|Keur Massar|Yeumbeul Sud|Yeumbeul|Sangalkam|Yoff|Grand Médine|Parcelles Assainies|Front de Terre|Pikine|Grand Yoff|Hann Maristes 1|Zone De Captage)$",i](14.65,-17.55,14.85,-17.15);nwr["name"~"CICES|Centenaire|^Zone de Captage$",i](14.66,-17.48,14.76,-17.40););out center tags;`;
    const body = await fetchRaw('osm_rain_places', OVERPASS, { ext: 'json', mirrors: OVERPASS_MIRRORS, init: { method: 'POST', body: new URLSearchParams({ data: q }) } });
    const json = JSON.parse(body);
    manifest.sources.osm_rain_places.source_updated_at = json.osm3s?.timestamp_osm_base || null;
    const places = json.elements
      .filter((e) => e.tags?.name)
      .map((e) => ({ name: e.tags.name, kind: e.tags.place || e.tags.highway || e.tags.amenity || e.tags.building || null, lat: e.lat ?? e.center.lat, lng: e.lon ?? e.center.lon, osm_id: `${e.type}/${e.id}` }));
    return { places };
  },

  // OSM: named parks, gardens and beaches -> "voies fluides & points relais".
  async osm_spots() {
    const q = `[out:json][timeout:60];(nwr["leisure"~"park|garden"]["name"](14.64,-17.54,14.80,-17.38);nwr["natural"="beach"]["name"](14.64,-17.54,14.80,-17.38););out center tags;`;
    const body = await fetchRaw('osm_spots', OVERPASS, { ext: 'json', mirrors: OVERPASS_MIRRORS, init: { method: 'POST', body: new URLSearchParams({ data: q }) } });
    const json = JSON.parse(body);
    manifest.sources.osm_spots.source_updated_at = json.osm3s?.timestamp_osm_base || null;
    const spots = json.elements
      .filter((e) => e.tags?.name && (e.lat || e.center))
      .map((e) => ({
        name: e.tags.name,
        category: e.tags.natural === 'beach' ? 'PLAGE' : 'PARC',
        lat: e.lat ?? e.center.lat,
        lng: e.lon ?? e.center.lon,
        osm_id: `${e.type}/${e.id}`,
      }));
    return { spots };
  },
};

// Press / editorial pages: stored raw + hashed for change detection; their
// content is curated by hand in data/curated/*.json (no stable markup).
const editorial = {
  ausenegal_programme: 'https://www.au-senegal.com/jeux-olympiques-de-la-jeunesse-dakar-2026-programme-complet-des-competitions,18284.html?lang=fr',
  senego_test_events_traffic: 'https://senego.com/tests-events-des-joj-dakar-2026-un-plan-de-circulation-special-mis-en-place-a-dakar_1990497.html',
  pressafrik_rue_louga: 'https://www.pressafrik.com/Travaux-des-JOJ-2026-la-rue-de-Louga-a-Point-E-fermee-a-partir-de-jeudi_a309755.html',
  senego_ter_brt: 'https://senego.com/services/horaires-brt-ter',
  aps_saly_traffic: 'https://aps.sn/joj-dakar-2026-un-plan-de-circulation-temporaire-presente-aux-populations-de-saly/',
  senego_rain_20261005: 'https://senego.com/pluies-a-dakar-mbao-keur-massar-et-yoff-sous-leau-le-brt-limite_2009268.html',
  senego_rain_72mm: 'https://senego.com/dakar-sous-les-eaux-72-mm-a-mbao-et-des-habitants-reclament-de-laide_2009147.html',
  senego_brt_flood_0915: 'https://senego.com/dakar-le-couloir-du-brt-et-les-grands-axes-submerges-par-les-eaux_2002893.html',
  dakaractu_inspection_1008: 'https://www.dakaractu.com/Inondation-a-Dakar-Le-ministre-Cheikh-Tidiane-Dieye-inspecte-les-points-critiques-et-annonce-un-leger-mieux_a276814.html',
};

await mkdir(OUT, { recursive: true });
let failures = 0;
for (const [id, run] of Object.entries(sources)) {
  if (only && !only.includes(id)) continue;
  try {
    const data = await run();
    // Raw pages carry nonces/timestamps; change detection uses the parsed data.
    const json = JSON.stringify(data, null, 2) + '\n';
    const parsed = createHash('sha256').update(json).digest('hex');
    const src = manifest.sources[id];
    src.changed_since_last_fetch = src.parsed_sha256 ? src.parsed_sha256 !== parsed : null;
    src.parsed_sha256 = parsed;
    await writeFile(path.join(OUT, `${id}.json`), json);
    const n = Object.values(data).find(Array.isArray)?.length;
    console.log(`ok   ${id} (${n ?? '-'} items, changed=${manifest.sources[id].changed_since_last_fetch})`);
  } catch (e) {
    failures++;
    console.error(`FAIL ${id}: ${e.message}`);
  }
}
for (const [id, url] of Object.entries(editorial)) {
  if (only && !only.includes(id)) continue;
  try {
    await fetchRaw(id, url);
    console.log(`ok   ${id} (raw, changed=${manifest.sources[id].changed_since_last_fetch})`);
  } catch (e) {
    // Some press sites block non-browser clients; keep previous record, flag it.
    manifest.sources[id] = { ...manifest.sources[id], id, url, method: 'manual-webfetch', last_error: e.message, last_attempt_at: new Date().toISOString() };
    console.warn(`warn ${id}: ${e.message} (kept as manual-webfetch)`);
  }
}
manifest.generated_at = new Date().toISOString();
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
process.exit(failures ? 1 : 0);
