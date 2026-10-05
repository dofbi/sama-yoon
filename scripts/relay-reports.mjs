#!/usr/bin/env node
// Relay traffic info seen on social networks into Sama Yoon as ordinary
// citizen reports (same display, 3 h expiry, push alerts). Used by the
// /info-trafic command (.claude/skills/info-trafic).
//
//   node scripts/relay-reports.mjs <file.json>            # dry run: geocode + preview
//   node scripts/relay-reports.mjs <file.json> --apply    # insert into Supabase
//   node scripts/relay-reports.mjs --list                 # live relayed reports
//
// Input: [{ "place": "VDN au niveau de Castors", "type": "INONDATION",
//           "note": "VDN — Castors", "posted_at": "2026-10-05T11:40:00Z",
//           "lat": 14.72, "lng": -17.44 }]   (lat/lng/note/posted_at optional)
// Needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
// (service_role: server-side only, never committed or sent to the browser).
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TYPES = ['INONDATION', 'BOUCHON', 'ROUTE_BLOQUEE', 'BARRAGE_POLICE'];
const MAX_AGE_H = 3;
const UA = 'SamaYoon/0.1 (relay; contact genova@dofbi.com)';
const BBOX = { south: 14.35, north: 14.95, west: -17.6, east: -16.9 }; // Dakar, Thiès coast

async function loadEnv() {
  const text = await readFile(path.join(ROOT, '.env.local'), 'utf8').catch(() => '');
  const env = Object.fromEntries(text.split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
  return { ...env, ...process.env };
}

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Known places from the app's own datasets first (stations, landmarks, rain
// places, venues), then OpenStreetMap Nominatim bounded to the Dakar region.
async function knownPlaces() {
  const dir = path.join(ROOT, 'public/data/events/jojdakar2026');
  const read = async (f) => JSON.parse(await readFile(path.join(dir, f), 'utf8')).items;
  const rainPlaces = JSON.parse(await readFile(path.join(ROOT, 'data/scraped/osm_rain_places.json'), 'utf8')).places;
  return [
    ...(await read('transit.json')).map((s) => ({ name: s.name, lat: s.latitude, lng: s.longitude, from: `${s.mode} (OSM)` })),
    ...(await read('landmarks.json')).map((s) => ({ name: s.name, lat: s.latitude, lng: s.longitude, from: 'repère (OSM)' })),
    ...rainPlaces.map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, from: 'quartier (OSM)' })),
    ...(await read('venues.json')).map((v) => ({ name: v.name, lat: v.coordinates.lat, lng: v.coordinates.lng, from: 'site JOJ' })),
  ];
}

let lastNominatim = 0;
async function nominatim(query) {
  const wait = lastNominatim + 1100 - Date.now(); // usage policy: <= 1 request / s
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q: query, format: 'jsonv2', countrycodes: 'sn', viewbox: `${BBOX.west},${BBOX.north},${BBOX.east},${BBOX.south}`, bounded: '1', limit: '1' });
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr' } });
  const [hit] = res.ok ? await res.json() : [];
  return hit ? { lat: +hit.lat, lng: +hit.lon, from: `Nominatim : ${hit.display_name.split(',').slice(0, 3).join(',')}` } : null;
}

async function geocode(item, known) {
  if (Number.isFinite(item.lat) && Number.isFinite(item.lng)) return { lat: item.lat, lng: item.lng, from: 'coordonnées fournies' };
  const q = norm(item.place);
  const exact = known.find((k) => norm(k.name) === q) || known.find((k) => q.includes(norm(k.name)) && norm(k.name).length >= 4);
  if (exact) return { lat: exact.lat, lng: exact.lng, from: `${exact.name} — ${exact.from}` };
  // Social posts say "VDN au niveau de Castors", "rond-point Case Bi"...:
  // try the full text, then the landmark part, then without the road prefix.
  const variants = [item.place];
  const landmark = item.place.split(/\s(?:au niveau d[eu']|à hauteur d[eu']|vers|devant|près d[eu']|en face d[eu']|après|avant)\s/i);
  if (landmark.length > 1) variants.push(landmark.at(-1), landmark[0]);
  variants.push(item.place.replace(/^(rond[- ]point|carrefour|bretelle|croisement|échangeur|pont)\s+(de\s+|du\s+|d')?/i, ''));
  for (const v of [...new Set(variants.map((x) => x.trim()).filter(Boolean))]) {
    const nv = norm(v);
    const local = known.find((k) => norm(k.name) === nv || (nv.length >= 4 && norm(k.name).includes(nv)));
    if (local) return { lat: local.lat, lng: local.lng, from: `${local.name} — ${local.from} (via « ${v} »)` };
    const hit = (await nominatim(`${v}, Dakar`)) || (await nominatim(v));
    if (hit) return { ...hit, from: `${hit.from} (via « ${v} »)` };
  }
  return null;
}

function validate(item) {
  if (!item.place || typeof item.place !== 'string') return 'lieu manquant';
  if (!TYPES.includes(item.type)) return `type inconnu (${item.type})`;
  if (item.posted_at && Date.now() - Date.parse(item.posted_at) > MAX_AGE_H * 3600e3) return `post de plus de ${MAX_AGE_H} h`;
  return null;
}

async function db(env, pathAndQuery, init = {}) {
  const base = (env.VITE_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('VITE_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans .env.local');
  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

const args = process.argv.slice(2);
const env = await loadEnv();

if (args.includes('--list')) {
  const rows = await db(env, `user_reports?select=id,created_at,report_type,description,upvotes,expires_at&origin=eq.relay&expires_at=gt.${new Date().toISOString()}&order=created_at.desc`);
  console.table(rows.map((r) => ({ type: r.report_type, lieu: r.description, '👍': r.upvotes, créé: r.created_at.slice(11, 16), expire: r.expires_at.slice(11, 16) })));
  process.exit(0);
}

const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node scripts/relay-reports.mjs <file.json> [--apply] | --list');
  process.exit(2);
}
const items = JSON.parse(await readFile(file, 'utf8'));
const known = await knownPlaces();
const ready = [];
const rows = [];
for (const item of items) {
  const problem = validate(item);
  const geo = problem ? null : await geocode(item, known);
  const inside = geo && geo.lat >= BBOX.south && geo.lat <= BBOX.north && geo.lng >= BBOX.west && geo.lng <= BBOX.east;
  const status = problem || (!geo ? 'lieu introuvable' : !inside ? 'hors zone' : 'ok');
  rows.push({ statut: status, type: item.type, lieu: item.place, position: geo ? `${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}` : '—', via: geo?.from || '' });
  if (status === 'ok') {
    ready.push({
      latitude: +geo.lat.toFixed(6),
      longitude: +geo.lng.toFixed(6),
      report_type: item.type,
      description: (item.note || item.place).replace(/\s+/g, ' ').trim().slice(0, 120),
      origin: 'relay',
    });
  }
}
console.table(rows);

if (!args.includes('--apply')) {
  console.log(`\n${ready.length}/${items.length} prêt(s). Dry run : rien n'a été envoyé (ajouter --apply).`);
  process.exit(0);
}
if (!ready.length) {
  console.log('Rien à envoyer.');
  process.exit(1);
}
const inserted = await db(env, 'user_reports?select=id,report_type,description,expires_at', { method: 'POST', body: JSON.stringify(ready) });
console.log(`\n✅ ${inserted.length} signalement(s) publiés (visibles 3 h, prolongés par chaque 👍) :`);
for (const r of inserted) console.log(`  · ${r.report_type} — ${r.description} (expire ${r.expires_at.slice(11, 16)} UTC) [${r.id}]`);
