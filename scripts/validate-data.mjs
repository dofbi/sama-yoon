#!/usr/bin/env node
// Checks the generated datasets (schema, provenance, freshness) and lints the
// UI copy + data against the editorial line (no "avoid the Games" vocabulary).
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { BANNED_WORDS } from '../src/i18n/fr.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const EVENT = process.argv[2] || 'jojdakar2026';
const DIR = path.join(ROOT, 'public/data/events', EVENT);
const errors = [];
const warn = [];
const err = (m) => errors.push(m);

const load = async (f) => JSON.parse(await readFile(path.join(DIR, f), 'utf8'));
const files = Object.fromEntries(await Promise.all((await readdir(DIR)).filter((f) => f.endsWith('.json')).map(async (f) => [f, await load(f)])));

const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CLOSED'];
const inDakarRegion = ({ lat, lng }) => lat > 14.3 && lat < 14.9 && lng > -17.6 && lng < -16.9;
const isIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

for (const [name, f] of Object.entries(files)) {
  const m = f.meta;
  if (!m?.dataset_version || !isIso(m.generated_at) || !isIso(m.last_checked_at)) err(`${name}: meta.dataset_version/generated_at/last_checked_at missing`);
  const known = new Set((m?.sources || []).map((s) => s.id));
  for (const s of m?.sources || []) {
    if (!s.url) err(`${name}: source ${s.id} has no url`);
    if (!s.fetched_at && !s.method?.startsWith('manual-')) err(`${name}: source ${s.id} has no fetched_at`);
  }
  for (const it of f.items) {
    for (const id of it.source_ids || []) if (!known.has(id)) err(`${name}: ${it.id} cites unknown source ${id}`);
    if (!(it.source_ids || []).length && it.status !== 'awaiting_official') err(`${name}: ${it.id} has no source_ids`);
  }
}

const venues = files['venues.json'].items;
const venueIds = new Set([...venues, ...(files['accommodations.json']?.items || []), ...(files['airport.json']?.items || [])].map((v) => v.id));
for (const v of venues) {
  if (!inDakarRegion(v.coordinates)) err(`venues: ${v.id} coordinates outside Dakar/Thiès region`);
  if (v.impact_type === 'radius' && !(v.impact_radius_meters > 0)) err(`venues: ${v.id} missing impact_radius_meters`);
  if (v.impact_type === 'corridor' && !(v.path?.length > 1)) err(`venues: ${v.id} corridor without path`);
  if (!v.sports?.length) err(`venues: ${v.id} without sports`);
}

const seen = new Set();
for (const e of files['events_schedule.json'].items) {
  if (seen.has(e.id)) err(`events: duplicate id ${e.id}`);
  seen.add(e.id);
  if (!venueIds.has(e.venue_id)) err(`events: ${e.id} unknown venue ${e.venue_id}`);
  if (!LEVELS.includes(e.impact_level)) err(`events: ${e.id} bad impact_level ${e.impact_level}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) err(`events: ${e.id} bad date`);
  if (!/^\d{2}:\d{2}$/.test(e.start_time) || !/^\d{2}:\d{2}$/.test(e.end_time) || e.start_time >= e.end_time) err(`events: ${e.id} bad time window`);
}
if (!files['events_schedule.json'].items.some((e) => e.id === 'evt_ceremonie_ouverture')) err('events: opening ceremony missing');

for (const s of files['quiet_spots.json'].items) {
  if (!['PARC', 'CAFE_TRAVAIL', 'PLAGE_CALME'].includes(s.category)) err(`spots: ${s.id} bad category`);
}

// Alert zones: every member exists, every impacting site belongs to a zone.
const zones = files['alert_zones.json']?.items || [];
const zoned = new Set(zones.flatMap((z) => z.venue_ids));
for (const z of zones) {
  for (const id of z.venue_ids) if (!venueIds.has(id)) err(`alert_zones: ${z.id} unknown site ${id}`);
  if (!z.venue_ids.length && !z.source_ids.length) err(`alert_zones: ${z.id} has no members`);
  if (!(z.radius_m > 0) || !inDakarRegion(z.center)) err(`alert_zones: ${z.id} bad geometry`);
}
for (const id of new Set(files['events_schedule.json'].items.map((e) => e.venue_id))) {
  if (zones.length && !zoned.has(id)) err(`alert_zones: site ${id} has events but no alert zone`);
}

// Rain notices: sourced, dated, located.
for (const n of files['rain_notices.json']?.items || []) {
  if (!isIso(n.reported_at) || !isIso(n.valid_until) || n.valid_until <= n.reported_at) err(`rain_notices: ${n.id} bad dates`);
  if (!['flooded', 'transit', 'watch'].includes(n.kind)) err(`rain_notices: ${n.id} bad kind`);
  if (!inDakarRegion(n.coordinates)) err(`rain_notices: ${n.id} outside region`);
}

// Traffic notices (decrees): dated, hourly windows well-formed, geometry in region.
const zoneIds = new Set(zones.map((z) => z.id));
// A window is either daily ({ start, end } in HH:MM) or dated ({ from, to }
// ISO, may span midnight or several days, inside the notice period).
const badWindow = (w, n) => (w.from
  ? !isIso(w.from) || !isIso(w.to) || Date.parse(w.from) >= Date.parse(w.to) || Date.parse(w.from) < Date.parse(n.starts_at) || Date.parse(w.to) > Date.parse(n.ends_at)
  : !/^\d{2}:\d{2}$/.test(w.start) || !/^\d{2}:\d{2}$/.test(w.end) || w.start >= w.end);
const SEGMENT_KINDS = ['olympic_lane', 'hgv_ban', 'reserved_exit', 'open_exit', 'closed', 'reserved_joj', 'pedestrian', 'deviation'];
for (const n of files['traffic_notices.json']?.items || []) {
  if (!isIso(n.starts_at) || !isIso(n.ends_at) || n.ends_at < n.starts_at) err(`traffic_notices: ${n.id} bad dates`);
  for (const w of n.windows || []) if (badWindow(w, n)) err(`traffic_notices: ${n.id} bad window ${w.start || w.from}-${w.end || w.to}`);
  for (const id of n.alert_zone_ids || []) if (!zoneIds.has(id)) err(`traffic_notices: ${n.id} unknown alert zone ${id}`);
  for (const s of n.segments || []) {
    if (!SEGMENT_KINDS.includes(s.kind)) err(`traffic_notices: ${n.id}/${s.id} bad kind`);
    const pts = s.point ? [s.point] : s.path || [];
    if (!pts.length || (!s.point && pts.length < 2)) err(`traffic_notices: ${n.id}/${s.id} has no geometry`);
    if (pts.some(([lat, lng]) => !inDakarRegion({ lat, lng }))) err(`traffic_notices: ${n.id}/${s.id} outside region`);
    for (const w of s.windows || []) if (badWindow(w, n)) err(`traffic_notices: ${n.id}/${s.id} bad window`);
  }
}

// Editorial lint: UI copy + every string in the datasets.
const strings = [];
const walk = (o, where) => {
  if (typeof o === 'string') strings.push([o, where]);
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (!['url', 'sha256', 'raw_file'].includes(k)) walk(v, `${where}.${k}`);
};
for (const [n, f] of Object.entries(files)) walk(f.items, n);
const ui = (await readFile(path.join(ROOT, 'src/i18n/fr.js'), 'utf8')).replace(/BANNED_WORDS = \[[^\]]*\]/, '');
strings.push([ui, 'src/i18n/fr.js']);
for (const [s, where] of strings) {
  const low = s.toLowerCase();
  for (const w of BANNED_WORDS) if (low.includes(w)) err(`editorial: "${w}" found in ${where}`);
}

const ageH = (Date.now() - Date.parse(files['events_schedule.json'].meta.last_checked_at)) / 3600e3;
if (ageH > 72) warn.push(`events_schedule.json last checked ${Math.round(ageH)} h ago — run npm run data:update`);

warn.forEach((w) => console.warn(`warn  ${w}`));
if (errors.length) {
  errors.forEach((e) => console.error(`error ${e}`));
  process.exit(1);
}
console.log(`ok    ${Object.keys(files).length} datasets valid (${venues.length} venues, ${files['events_schedule.json'].items.length} events)`);
