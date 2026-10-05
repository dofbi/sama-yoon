#!/usr/bin/env node
// Merges data/scraped/* (machine-collected) with data/curated/<event>.json
// (hand-checked facts + Sama Yoon estimates) into the app datasets under
// public/data/events/<event>/ (fetched at runtime). Each file is { meta, items } where meta carries the
// dataset version and, per source, when it was fetched and last updated.
//
// Usage: node scripts/build-data.mjs [event=jojdakar2026]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { athletesPerSport, computeWaves } from './lib/waves.mjs';
import { peakWindows } from './lib/aibd.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const EVENT = process.argv[2] || 'jojdakar2026';
const OUT = path.join(ROOT, 'public/data/events', EVENT);
const readJson = async (p) => JSON.parse(await readFile(path.join(ROOT, p), 'utf8'));

const manifest = await readJson('data/raw/manifest.json');
const curated = await readJson(`data/curated/${EVENT}.json`);
const scraped = {};
for (const id of ['tickets_sessions', 'tickets_venues', 'wikipedia_calendar', 'osm_transit', 'osm_spots', 'osm_corniche', 'osm_landmarks', 'osm_accommodation', 'osm_aibd', 'aibd_board', 'wikipedia_quotas']) {
  scraped[id] = await readJson(`data/scraped/${id}.json`);
}

const generatedAt = new Date().toISOString();

function sourceMeta(ids) {
  return [...new Set(ids)].sort().map((id) => {
    const m = manifest.sources[id] || {};
    const e = curated.editorial_sources[id] || {};
    return {
      id,
      title: e.title || null,
      official: !!e.official,
      note: e.note || null,
      publisher: e.publisher || null,
      url: m.url || e.url || null,
      method: m.method || e.method || null,
      fetched_at: m.fetched_at || null,
      source_published_at: e.source_published_at ?? null,
      source_updated_at: m.source_updated_at || m.http_last_modified || null,
      source_revision: m.source_revision ?? null,
      sha256: m.sha256 || null,
    };
  });
}

const hav = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// ---- venues -------------------------------------------------------------
function corridorPath({ south, north }) {
  // Walk the carriageway vertices nearest-neighbour from the southern end so
  // the line follows the road even where it runs east-west (Soumbédioune).
  // Both carriageways are ~20 m apart, invisible at map stroke width.
  const pts = scraped.osm_corniche.ways
    .flatMap((w) => w.path)
    .filter(([lat]) => lat >= south && lat <= north)
    .map(([lat, lng]) => ({ lat, lng }));
  if (!pts.length) return [];
  let cur = pts.reduce((a, p) => (p.lat < a.lat ? p : a));
  const left = new Set(pts);
  const out = [];
  while (cur) {
    left.delete(cur);
    const last = out.at(-1);
    if (!last || hav(last, cur) > 40) out.push(cur);
    let next = null, best = Infinity;
    for (const p of left) {
      const d = hav(cur, p);
      if (d < best) [best, next] = [d, p];
    }
    cur = best < 400 ? next : null;
  }
  return out.map((p) => [p.lat, p.lng]);
}

const venueItems = scraped.tickets_venues.venues.map((v) => {
  const c = curated.venues[v.code];
  if (!c) throw new Error(`No curated entry for venue ${v.code}`);
  const coords = c.coordinates_from === 'plus_code' ? v.plus_code_coordinates : v.maps_coordinates;
  const item = {
    id: c.id,
    code: v.code,
    name: c.display_name,
    official_name: v.name,
    neighborhood: c.neighborhood,
    city: c.city,
    address: v.address,
    plus_code: v.plus_code,
    coordinates: { lat: +coords.lat.toFixed(6), lng: +coords.lng.toFixed(6) },
    impact_type: c.impact_type,
    sports: v.disciplines,
    fan_zone: !!c.fan_zone,
    verified: true,
    source_ids: ['tickets_venues'],
    last_verified_at: manifest.sources.tickets_venues.fetched_at,
  };
  if (c.impact_type === 'radius') item.impact_radius_meters = c.impact_radius_meters;
  else {
    item.path = corridorPath(c.corridor_bounds);
    item.path_note = 'Tracé indicatif (OpenStreetMap). Parcours exact de l\'épreuve non publié.';
    item.source_ids.push('osm_corniche');
  }
  if (c.coordinates_note) item.coordinates_note = c.coordinates_note;
  if (c.context) {
    item.context = c.context;
    item.source_ids.push(...(c.context_source_ids || []));
  }
  return item;
});
const venueByCode = Object.fromEntries(venueItems.map((v) => [v.code, v]));

// ---- events schedule ----------------------------------------------------
const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CLOSED'];
const bump = (lvl) => LEVELS[Math.min(LEVELS.indexOf(lvl) + 1, 2 + (lvl === 'CLOSED'))];
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);

const perVenueDay = new Map();
for (const { sport, schedule } of scraped.wikipedia_calendar.sports) {
  const map = curated.sport_venues[sport];
  if (!map || Array.isArray(map)) continue;
  for (const [date, status] of Object.entries(schedule)) {
    for (const code of map.venues) {
      const key = `${code}|${date}`;
      const e = perVenueDay.get(key) || { code, date, sports: [], medals: 0 };
      e.sports.push(map.fr);
      if (status.startsWith('medals:')) e.medals += +status.split(':')[1];
      perVenueDay.set(key, e);
    }
  }
}
// Earliest ticketed session per venue/day (exact official times when known).
const firstSession = {};
const codeByPlace = { "Complexe Tour de l'Oeuf": 'CTO', 'Saly Plage Ouest': 'SBW', 'Centre des Expositions de Dakar': 'DEX', 'Stade Abdoulaye Wade': 'SAW' };
for (const s of scraped.tickets_sessions.sessions) {
  const code = Object.entries(codeByPlace).find(([n]) => s.venue_name.startsWith(n))?.[1];
  if (!code || !s.starts_at) continue;
  const key = `${code}|${s.starts_at.slice(0, 10)}`;
  const t = s.starts_at.slice(11, 16);
  if (!firstSession[key] || t < firstSession[key]) firstSession[key] = t;
}

const events = [...perVenueDay.values()]
  .sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code))
  .map((e) => {
    const c = curated.venues[e.code];
    let level = c.competition_level_estimate || c.base_level_estimate;
    if (e.medals > 0 && !c.competition_level_estimate) level = bump(level);
    let [start, end] = c.daily_window_estimate;
    const first = firstSession[`${e.code}|${e.date}`];
    const timesFromTickets = !!first;
    if (first) start = hhmm(Math.max(0, toMin(first) - 60));
    const sports = [...new Set(e.sports)];
    const medalTxt = e.medals ? ` — ${e.medals} finale${e.medals > 1 ? 's' : ''}` : '';
    const desc = e.code === 'COR'
      ? `Épreuve de cyclisme sur route${medalTxt} — Corniche Ouest réservée à la course`
      : `${sports.join(', ')}${medalTxt}`;
    return {
      id: `evt_${e.date.replaceAll('-', '')}_${e.code.toLowerCase()}`,
      venue_id: venueByCode[e.code].id,
      date: e.date,
      start_time: start,
      end_time: end,
      impact_level: level,
      description: desc,
      sports,
      medal_events: e.medals,
      schedule_verified: true,
      impact_estimate: true,
      time_window_source: timesFromTickets ? 'tickets_sessions (1re session − 1 h)' : 'estimation Sama Yoon',
      source_ids: ['wikipedia_calendar', 'tickets_venues', ...(timesFromTickets ? ['tickets_sessions'] : [])],
    };
  });
for (const cer of curated.ceremonies) {
  events.push({
    id: cer.id,
    venue_id: venueByCode[cer.venue].id,
    date: cer.date,
    start_time: cer.start_time,
    end_time: cer.end_time,
    impact_level: cer.impact_level,
    description: cer.description,
    sports: [],
    medal_events: 0,
    schedule_verified: cer.verified,
    impact_estimate: true,
    time_window_source: cer.time_window_note,
    source_ids: cer.source_ids,
  });
}
// ---- accommodations (Youth Olympic Village, partner-hotel hubs) -------------
const accScraped = scraped.osm_accommodation;
const accommodations = (curated.accommodations || []).map((a) => {
  const pt = a.osm_key === 'village' ? accScraped.village : accScraped.places.find((p) => p.name === a.osm_key);
  if (!pt) throw new Error(`No OSM location for accommodation ${a.id}`);
  const item = {
    id: a.id,
    kind: a.kind,
    name: a.name,
    neighborhood: a.neighborhood,
    city: a.city,
    coordinates: { lat: +pt.lat.toFixed(6), lng: +pt.lng.toFixed(6) },
    facts: a.facts,
    verified: a.verified,
    source_ids: a.fact_source_ids,
  };
  if (a.impact_radius_meters) {
    item.impact_type = 'radius';
    item.impact_radius_meters = a.impact_radius_meters;
  }
  if (a.flows_note) item.flows_note = a.flows_note;
  return item;
});
for (const a of curated.accommodations || []) {
  if (!a.flows_estimate) continue;
  const [from, to] = a.flows_dates;
  for (let d = from; d <= to; ) {
    a.flows_estimate.forEach((f, i) =>
      events.push({
        id: `evt_${d.replaceAll('-', '')}_${a.id}_${i}`,
        venue_id: a.id,
        date: d,
        start_time: f.start_time,
        end_time: f.end_time,
        impact_level: f.impact_level,
        description: f.description,
        sports: [],
        medal_events: 0,
        schedule_verified: false,
        impact_estimate: true,
        time_window_source: a.flows_note,
        source_ids: a.fact_source_ids,
      }),
    );
    const nd = new Date(`${d}T12:00:00Z`);
    nd.setUTCDate(nd.getUTCDate() + 1);
    d = nd.toISOString().slice(0, 10);
  }
}

// ---- airport hub + delegation waves -----------------------------------------
const ap = curated.airport;
const aibd = scraped.osm_aibd;
const apPoint = aibd.terminal || aibd.aerodrome;
const motorwayPath = (() => {
  // Directed walk along motorway vertices: from the airport, step to the
  // neighbour (<400 m) that gets closest to the next waypoint. Avoids ramps and
  // the eastbound branches a plain nearest-neighbour walk would follow.
  const pts = aibd.motorway
    .filter((w) => ap.corridor_motorway_names.includes(w.name))
    .flatMap((w) =>
      // Densify: straight motorway stretches have vertices kilometres apart.
      w.path.flatMap(([lat, lng], i) => {
        if (!i) return [{ lat, lng }];
        const [plat, plng] = w.path[i - 1];
        const n = Math.ceil(hav({ lat: plat, lng: plng }, { lat, lng }) / 100);
        return Array.from({ length: n }, (_, k) => ({ lat: plat + ((lat - plat) * (k + 1)) / n, lng: plng + ((lng - plng) * (k + 1)) / n }));
      }),
    );
  if (!pts.length) return [];
  const waypoints = ap.corridor_waypoints.map(([lat, lng]) => ({ lat, lng }));
  let cur = pts.reduce((a, p) => (hav(p, apPoint) < hav(a, apPoint) ? p : a));
  const out = [cur];
  for (const target of waypoints) {
    for (let guard = 0; guard < 20000 && hav(cur, target) > 300; guard++) {
      let next = null;
      for (const p of pts) {
        if (p === cur || hav(cur, p) > 400) continue;
        if (!next || hav(p, target) < hav(next, target)) next = p;
      }
      if (!next || hav(next, target) >= hav(cur, target)) break;
      cur = next;
      if (hav(out.at(-1), cur) > 400) out.push(cur);
    }
  }
  return out.map((p) => [+p.lat.toFixed(5), +p.lng.toFixed(5)]);
})();
const baseline = scraped.aibd_board.baseline;
const windows = peakWindows(baseline.hours);
const perSport = athletesPerSport(scraped.wikipedia_calendar.sports, scraped.wikipedia_quotas.quotas, ap.wave_model.total_athletes);
const waves = computeWaves(perSport, ap.wave_model);
const waveSources = ['wikipedia_calendar', 'wikipedia_quotas', 'usarchery_faq', ap.wave_model.total_source_id];
const airport = {
  id: ap.id,
  kind: ap.kind,
  name: ap.name,
  neighborhood: ap.neighborhood,
  city: ap.city,
  coordinates: { lat: +apPoint.lat.toFixed(6), lng: +apPoint.lng.toFixed(6) },
  impact_type: 'radius',
  impact_radius_meters: ap.impact_radius_meters,
  path: motorwayPath,
  path_note: "Autoroute à péage Dakar – Diamniadio – AIBD (OpenStreetMap).",
  facts: ap.facts,
  tips: ap.tips,
  baseline: { date: baseline.day, arrivals: baseline.arrivals, departures: baseline.departures, peak_hour: baseline.peak_hour, hours: baseline.hours, peak_windows: windows },
  flows_note: ap.wave_model.note,
  verified: true,
  source_ids: [...ap.fact_source_ids, 'aibd_board'],
};
for (const w of waves) {
  if (w.level === 'FLUID') continue;
  const parts = [];
  if (w.arrivals_est) parts.push(`≈${w.arrivals_est} athlètes à l'arrivée`);
  if (w.departures_est) parts.push(`≈${w.departures_est} au départ`);
  windows.forEach(([start, end], i) =>
    events.push({
      id: `evt_${w.date.replaceAll('-', '')}_hub_aibd_${i}`,
      venue_id: ap.id,
      date: w.date,
      start_time: start,
      end_time: end,
      impact_level: w.level,
      description: `Vague des délégations : ${parts.join(', ')}`,
      sports: [],
      medal_events: 0,
      schedule_verified: false,
      impact_estimate: true,
      time_window_source: `Pointe habituelle de l'AIBD (tableau officiel du ${baseline.day})`,
      source_ids: [...waveSources, 'aibd_board'],
    }),
  );
}
const waveItems = waves.map((w) => ({ ...w, impact_estimate: true, source_ids: waveSources }));

events.sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));

// ---- quiet spots ("voies fluides & points relais") ------------------------
const qs = curated.quiet_spots;
const dakarVenues = venueItems.filter((v) => v.city === 'Dakar');
const nearVenue = (p) => dakarVenues.some((v) => {
  const pts = [v.coordinates, ...(v.path || []).map(([lat, lng]) => ({ lat, lng }))];
  return pts.some((q) => hav(p, q) < qs.min_distance_from_dakar_venues_m);
});
const seenSpot = new Set();
const spots = scraped.osm_spots.spots
  .filter((s) => !qs.exclude_names.includes(s.name) && !nearVenue(s))
  .filter((s) => !seenSpot.has(s.name.toLowerCase()) && seenSpot.add(s.name.toLowerCase()))
  .map((s) => ({
    id: `spot_${s.osm_id.replace('/', '_')}`,
    name: s.name,
    category: s.category === 'PLAGE' ? 'PLAGE_CALME' : 'PARC',
    latitude: +s.lat.toFixed(6),
    longitude: +s.lng.toFixed(6),
    description: qs.descriptions[s.name] || null,
    source_ids: ['osm_spots'],
  }));

// ---- transit --------------------------------------------------------------
const stations = scraped.osm_transit.stations.map((s) => {
  const near = venueItems
    .map((v) => ({ v, d: hav(s, v.coordinates) }))
    .filter(({ d }) => d < 1500)
    .sort((a, b) => a.d - b.d)[0];
  return {
    id: `${s.mode.toLowerCase()}_${s.osm_id.replace('/', '_')}`,
    mode: s.mode,
    name: s.name,
    latitude: +s.lat.toFixed(6),
    longitude: +s.lng.toFixed(6),
    nearest_venue: near ? { venue_id: near.v.id, distance_m: Math.round(near.d) } : null,
    source_ids: ['osm_transit'],
  };
});

// ---- landmarks (decorative, zoom >= 13) ------------------------------------
const LANDMARK_ICON = [[/renaissance/i, 'renaissance'], [/mosqu/i, 'mosque'], [/soumb/i, 'pirogue'], [/phare/i, 'lighthouse']];
const seenLm = new Set();
const landmarks = scraped.osm_landmarks.landmarks
  .filter((l) => !seenLm.has(l.name.toLowerCase()) && seenLm.add(l.name.toLowerCase()))
  .map((l) => ({
    id: `lm_${l.osm_id.replace('/', '_')}`,
    name: l.name,
    icon: LANDMARK_ICON.find(([re]) => re.test(l.name))?.[1] || 'landmark',
    latitude: +l.lat.toFixed(6),
    longitude: +l.lng.toFixed(6),
    source_ids: ['osm_landmarks'],
  }));

// ---- write with versioning -------------------------------------------------
const today = generatedAt.slice(0, 10);
const files = {
  'venues.json': { items: venueItems },
  'events_schedule.json': { items: events },
  'quiet_spots.json': { items: spots },
  'transit.json': { lines: curated.transit, items: stations },
  'traffic_notices.json': { items: curated.traffic_notices },
  'landmarks.json': { items: landmarks },
  'accommodations.json': { items: accommodations },
  'airport.json': { items: [airport] },
  'delegation_waves.json': { model: ap.wave_model, sports: perSport, items: waveItems },
};
await mkdir(OUT, { recursive: true });
const changes = [];
for (const [name, body] of Object.entries(files)) {
  const file = path.join(OUT, name);
  const prev = JSON.parse(await readFile(file, 'utf8').catch(() => 'null'));
  // Verification timestamps change on every fetch; they must not create a new version.
  const stable = JSON.stringify(body, (k, v) => (k === 'last_verified_at' ? undefined : v));
  const contentHash = createHash('sha256').update(stable).digest('hex').slice(0, 16);
  let version = prev?.meta?.dataset_version;
  if (prev?.meta?.content_hash !== contentHash) {
    const n = version?.startsWith(today) ? +version.split('.')[1] + 1 : 1;
    version = `${today}.${n}`;
    changes.push(`${name} → ${version}`);
  }
  const ids = [
    ...(body.items || []).flatMap((i) => i.source_ids || []),
    ...Object.values(body.lines || {}).flatMap((l) => l.source_ids || []),
  ];
  const meta = {
    event: EVENT,
    dataset_version: version,
    content_hash: contentHash,
    generated_at: prev?.meta?.content_hash === contentHash ? prev.meta.generated_at : generatedAt,
    last_checked_at: generatedAt,
    sources: sourceMeta(ids),
  };
  await writeFile(file, JSON.stringify({ meta, ...body }, null, 2) + '\n');
}

if (changes.length) {
  const logPath = path.join(ROOT, 'data/CHANGELOG.md');
  const log = await readFile(logPath, 'utf8').catch(() => '# Data changelog\n\nUne entrée par génération qui modifie un jeu de données.\n');
  const fetched = Object.values(manifest.sources).filter((s) => s.fetched_at).map((s) => `${s.id} (${s.fetched_at.slice(0, 16)}Z${s.changed_since_last_fetch ? ', modifié' : ''})`);
  const entry = `\n## ${generatedAt.slice(0, 16)}Z — ${EVENT}\n\n${changes.map((c) => `- ${c}`).join('\n')}\n- Sources collectées : ${fetched.join(', ')}\n`;
  await writeFile(logPath, log.replace(/\n*$/, '\n') + entry);
}
// ---- data/SOURCES.md (human-readable provenance report) --------------------
const allIds = Object.keys(manifest.sources).concat(Object.keys(curated.editorial_sources)).filter((v, i, a) => a.indexOf(v) === i);
const rows = sourceMeta(allIds)
  .sort((a, b) => b.official - a.official || a.id.localeCompare(b.id))
  .map((s) => `| ${s.official ? '**officiel** ' : ''}${s.title || s.id} | ${s.publisher || ''} | ${s.source_published_at || '—'} | ${s.source_updated_at || (s.source_revision ? `rév. ${s.source_revision}` : '—')} | ${s.fetched_at ? s.fetched_at.slice(0, 16) + 'Z' : 'manuel'} | ${s.method || ''} | ${s.url ? `[lien](${s.url})` : ''} |`);
const md = `# Sources des données — ${EVENT}

Généré par \`scripts/build-data.mjs\` le ${generatedAt.slice(0, 16)}Z. Ne pas éditer à la main.

- Collecte : \`npm run data:scrape\` (pages brutes + sha256 dans \`data/raw/\`)
- Génération : \`npm run data:build\` → \`public/data/events/${EVENT}/*.json\` (chaque fichier porte \`meta.dataset_version\` et la date de collecte de chaque source)
- Historique : \`data/CHANGELOG.md\`

| Source | Éditeur | Publiée le | Mise à jour (source) | Collectée le | Méthode | URL |
|---|---|---|---|---|---|---|
${rows.join('\n')}

## Ce qui est officiel, ce qui est estimé

- **Officiel** : sites, Plus Codes, disciplines par site (guide de la billetterie COJOJ) ; grille jour × sport (programme officiel du 2 février 2026, via Wikipédia) ; horaires exacts des premières sessions affichées par la billetterie ; cérémonie d'ouverture (31 oct., 17:45, Stade Abdoulaye Wade).
- **Estimé par Sama Yoon** (\`impact_estimate: true\`) : niveau d'impact trafic, fenêtres horaires d'affluence, rayon des périmètres. Méthode : niveau de base par site (densité urbaine), +1 niveau les jours de finales, Corniche Ouest « réservée » 07:00-14:00 les jours de course.
- **À confirmer** (\`verified: false\`) : lieu et heure de la cérémonie de clôture ; tracé exact de l'épreuve sur la Corniche.
- **En attente** : aucun arrêté de circulation couvrant la période des Jeux n'était publié à la date de collecte (seuls ceux des épreuves tests d'août 2026 et des travaux sont référencés).

## Écarts relevés entre sources

${curated.sport_venue_conflicts.map((c) => `- ${c}`).join('\n')}
${Object.values(curated.venues).filter((v) => v.coordinates_note).map((v) => `- ${v.display_name} : ${v.coordinates_note}`).join('\n')}
- Billetterie complète (toutes sessions) protégée par CAPTCHA : non collectée ; seules les sessions publiques de la page d'accueil sont utilisées.
`;
await writeFile(path.join(ROOT, 'data/SOURCES.md'), md);

console.log(`landmarks=${landmarks.length} venues=${venueItems.length} events=${events.length} spots=${spots.length} stations=${stations.length}`);
console.log(changes.length ? `changed: ${changes.join(', ')}` : 'no dataset change');
