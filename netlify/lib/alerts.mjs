// Which push alerts are due right now. Pure functions (no I/O) shared by the
// scheduled dispatcher and the admin preview, covered by scripts/test-impact.mjs.
// Dakar = UTC+0, so ISO dates/times are local wall-clock values.
import { fr } from '../../src/i18n/fr.js';
import { distanceMeters } from '../../src/impact.js';

const LEVEL_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CLOSED: 4 };
const ALERT_LEVELS = new Set(['HIGH', 'CLOSED']);
const EVE_WINDOW = ['19:00', '21:59'];
const SOON_MINUTES = [1, 70];
export const CITIZEN = { windowMin: 30, minReports: 3, minConfirmations: 5 };

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => d.toISOString().slice(0, 10);
const hhmm = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
};
const minutesUntil = (now, day, time) => (Date.parse(`${day}T${time}:00Z`) - now.getTime()) / 60000;
export const inQuietHours = (now, [from, to]) => {
  const t = hhmm(now);
  return from > to ? t >= from || t < to : t >= from && t < to;
};

// Only competition venues and ceremonies trigger official alerts (not the
// airport waves or the estimated village / HQ flows).
const isOfficialSite = (venueId) => venueId.startsWith('venue_');

function zonesOf(venueId, zones) {
  return zones.filter((z) => z.venue_ids.includes(venueId));
}

function summarise(evs) {
  const start = evs.map((e) => e.start_time).sort()[0];
  const end = evs.map((e) => e.end_time).sort().at(-1);
  const level = evs.reduce((a, e) => (LEVEL_RANK[e.impact_level] > LEVEL_RANK[a] ? e.impact_level : a), 'LOW');
  const what = evs.length === 1 ? `${evs[0].description.split(' — ')[0]}.` : `${evs.length} créneaux programmés.`;
  return { start, end: end === '23:59' ? '00:00' : end, level, levelLabel: fr.levels[level].label, what };
}

// Eve (19:00-21:59, for tomorrow) and "soon" (start within 70 min) alerts,
// grouped per zone so several venues of one zone make one notification.
export function dueOfficialAlerts(events, zones, now, sentKeys = new Set()) {
  const out = [];
  const today = isoDay(now);
  const t = hhmm(now);
  const byZone = (pred) => {
    const map = new Map();
    for (const e of events) {
      if (!ALERT_LEVELS.has(e.impact_level) || !isOfficialSite(e.venue_id) || !pred(e)) continue;
      for (const z of zonesOf(e.venue_id, zones)) map.set(z.id, [...(map.get(z.id) || []), e]);
    }
    return map;
  };

  if (t >= EVE_WINDOW[0] && t <= EVE_WINDOW[1]) {
    const tomorrow = addDays(today, 1);
    for (const [zoneId, evs] of byZone((e) => e.date === tomorrow)) {
      const key = `${zoneId}:${tomorrow}:eve`;
      if (sentKeys.has(key)) continue;
      const zone = zones.find((z) => z.id === zoneId);
      const s = summarise(evs);
      out.push({ key, zone_id: zoneId, kind: 'official_eve', trigger: 'official', title: fr.push.eveTitle(zone.name), body: fr.push.eveBody(s.start, s.end, s.levelLabel, s.what), url: `/?zone=${zoneId}&day=${tomorrow}` });
    }
  }

  if (!inQuietHours(now, ['22:00', '06:00'])) {
    const soon = byZone((e) => {
      const m = minutesUntil(now, e.date, e.start_time);
      return m >= SOON_MINUTES[0] && m <= SOON_MINUTES[1];
    });
    for (const [zoneId, evs] of soon) {
      const s = summarise(evs);
      const key = `${zoneId}:${evs[0].date}:${s.start}:soon`;
      if (sentKeys.has(key)) continue;
      const zone = zones.find((z) => z.id === zoneId);
      const min = Math.max(1, Math.round(minutesUntil(now, evs[0].date, s.start)));
      out.push({ key, zone_id: zoneId, kind: 'official_soon', trigger: 'official', title: fr.push.soonTitle(zone.name, min), body: fr.push.soonBody(s.start, s.end, s.levelLabel, s.what), url: `/?zone=${zoneId}` });
    }
  }
  return out;
}

// A zone fires when >= 3 live reports, or >= 5 confirmations in total, were
// posted in it during the last 30 minutes. At most one alert per zone per hour.
export function citizenAlerts(reports, zones, now, sentKeys = new Set()) {
  if (inQuietHours(now, ['23:00', '06:00'])) return [];
  const since = now.getTime() - CITIZEN.windowMin * 60000;
  const recent = reports.filter((r) => Date.parse(r.created_at) >= since && Date.parse(r.expires_at) > now.getTime());
  const hourKey = now.toISOString().slice(0, 13);
  const out = [];
  for (const z of zones) {
    const inside = recent.filter((r) => distanceMeters(z.center, { lat: r.latitude, lng: r.longitude }) <= z.radius_m);
    const confirmations = inside.reduce((n, r) => n + (r.upvotes || 1), 0);
    if (inside.length < CITIZEN.minReports && confirmations < CITIZEN.minConfirmations) continue;
    const key = `${z.id}:citizen:${hourKey}`;
    if (sentKeys.has(key)) continue;
    const counts = {};
    for (const r of inside) counts[r.report_type] = (counts[r.report_type] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const label = fr.report.types[top]?.label || 'Info-trafic';
    out.push({ key, zone_id: z.id, kind: 'citizen', trigger: 'citizen', title: fr.push.citizenTitle(z.name), body: fr.push.citizenBody(inside.length, label), url: `/?zone=${z.id}` });
  }
  return out;
}

// Validate a PushSubscription JSON sent by the browser.
export function parseSubscription(body, knownZones) {
  const sub = body?.subscription;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (typeof endpoint !== 'string' || !/^https:\/\/[^\s]{10,990}$/.test(endpoint)) return { error: 'invalid_endpoint' };
  if (typeof p256dh !== 'string' || p256dh.length > 200 || typeof auth !== 'string' || auth.length > 100) return { error: 'invalid_keys' };
  const zones = [...new Set((body.zones || []).filter((z) => knownZones.includes(z)))];
  if (!zones.length) return { error: 'no_zone' };
  const triggers = [...new Set((body.triggers || ['official', 'citizen']).filter((t) => t === 'official' || t === 'citizen'))];
  if (!triggers.length) return { error: 'no_trigger' };
  return { endpoint, p256dh, auth, zones, triggers };
}
