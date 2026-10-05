// Pure functions: given the official schedule and a time filter, compute the
// traffic level per venue. No DOM, no Leaflet — covered by scripts/test-impact.mjs.
export const LEVEL_ORDER = ['FLUID', 'LOW', 'MEDIUM', 'HIGH', 'CLOSED'];

export const LEVEL_COLORS = {
  FLUID: '#3F7A3A',
  LOW: '#3F7A3A',
  MEDIUM: '#E08A1E',
  HIGH: '#B3261E',
  CLOSED: '#B3261E',
};

const maxLevel = (a, b) => (LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b);

export const isoDate = (d) => d.toISOString().slice(0, 10);
export const hhmm = (d) => d.toISOString().slice(11, 16);
export const addDays = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
};

// Dakar = UTC+0, so the wall clock is the UTC clock (see config/event.js).
export function resolveFilter(filter, now, pickedDate) {
  const today = isoDate(now);
  if (filter === 'now') return { date: today, time: hhmm(now) };
  if (filter === 'today') return { date: today, time: null };
  if (filter === 'tomorrow') return { date: addDays(today, 1), time: null };
  return { date: pickedDate || today, time: null };
}

export function eventsFor(events, { date, time }) {
  return events.filter((e) => e.date === date && (!time || (e.start_time <= time && time < e.end_time)));
}

// Returns Map<venue_id, { level, events }> for every venue (FLUID when idle).
export function computeVenueLevels(venues, events, window) {
  const active = eventsFor(events, window);
  const out = new Map(venues.map((v) => [v.id, { level: 'FLUID', events: [] }]));
  for (const e of active) {
    const cur = out.get(e.venue_id);
    if (!cur) continue;
    cur.events.push(e);
    cur.level = maxLevel(cur.level, e.impact_level);
  }
  return out;
}

export function gamesPhase(event, now) {
  const today = isoDate(now);
  if (today < event.startDate) {
    const days = Math.round((new Date(`${event.startDate}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 864e5);
    return { phase: 'before', days };
  }
  if (today > event.endDate) return { phase: 'after' };
  return { phase: 'during' };
}

export function gamesDays(event) {
  const days = [];
  for (let d = event.startDate; d <= event.endDate; d = addDays(d, 1)) days.push(d);
  return days;
}

export function distanceMeters(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Nearest named place (venue, station, spot, landmark) for human-readable
// report locations: "vers Complexe Tour de l'Œuf".
export function nearestPlace(point, places, maxMeters = 2500) {
  let best = null;
  for (const p of places) {
    const d = distanceMeters(point, p);
    if (d <= maxMeters && (!best || d < best.d)) best = { ...p, d };
  }
  return best;
}
