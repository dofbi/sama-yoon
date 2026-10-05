// Rain risk from Open-Meteo hourly forecasts. Pure functions (no I/O) shared
// by the weather function, the push dispatcher and the app; tested in
// scripts/test-impact.mjs. Dakar = UTC+0: Open-Meteo local times are UTC.
export const RISK_ORDER = ['NONE', 'LIGHT', 'RAIN', 'HEAVY'];

// Thresholds (mm). Documented in README; tuned for Dakar's flash floods, where
// a few millimetres per hour already flood low-lying streets.
export const THRESHOLDS = {
  lightMmPerHour: 1, // a wet hour that is likely (probability >= 50 %)
  rain3hMm: 5, // >= 5 mm within 3 h
  rainProbable: { probability: 70, mm: 2 }, // or >= 70 % and >= 2 mm in 3 h
  heavy6hMm: 20, // >= 20 mm within 6 h
  heavyMmPerHour: 10, // or a single hour >= 10 mm
};

const rank = (r) => RISK_ORDER.indexOf(r);
const sum = (a) => a.reduce((n, x) => n + (x || 0), 0);

// hours: [{ time: '2026-10-05T15:00', mm, prob }] sorted, starting at "now".
export function riskFor(hours, t = THRESHOLDS) {
  let risk = 'NONE';
  for (let i = 0; i < hours.length; i++) {
    const h = hours[i];
    const w3 = hours.slice(i, i + 3);
    const w6 = hours.slice(i, i + 6);
    const mm3 = sum(w3.map((x) => x.mm));
    const prob3 = Math.max(...w3.map((x) => x.prob ?? 0));
    let r = 'NONE';
    if (h.mm >= t.lightMmPerHour && (h.prob ?? 100) >= 50) r = 'LIGHT';
    if (mm3 >= t.rain3hMm || (prob3 >= t.rainProbable.probability && mm3 >= t.rainProbable.mm)) r = 'RAIN';
    if (sum(w6.map((x) => x.mm)) >= t.heavy6hMm || h.mm >= t.heavyMmPerHour) r = 'HEAVY';
    if (rank(r) > rank(risk)) risk = r;
  }
  return risk;
}

// First contiguous wet window (hours with >= 0.5 mm or probability >= 60 %).
export function rainWindow(hours) {
  const wet = (h) => (h.mm ?? 0) >= 0.5 || (h.prob ?? 0) >= 60;
  const start = hours.findIndex(wet);
  if (start < 0) return null;
  let end = start;
  while (end + 1 < hours.length && wet(hours[end + 1])) end++;
  const slice = hours.slice(start, end + 1);
  return {
    start: hours[start].time,
    end: hours[end].time,
    from: hours[start].time.slice(11, 13) + 'h',
    to: String((+hours[end].time.slice(11, 13) + 1) % 24).padStart(2, '0') + 'h',
    mm: Math.round(sum(slice.map((x) => x.mm)) * 10) / 10,
    prob: Math.max(...slice.map((x) => x.prob ?? 0)),
  };
}

// Summary for the next `aheadHours` from `now`.
export function outlook(hours, now, aheadHours = 12) {
  const from = now.toISOString().slice(0, 13);
  const next = hours.filter((h) => h.time.slice(0, 13) >= from).slice(0, aheadHours);
  return { risk: riskFor(next), window: rainWindow(next), hours: next };
}

// Zone forecast -> Open-Meteo multi-location request.
export function openMeteoUrl(points) {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.search = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(','),
    longitude: points.map((p) => p.lng.toFixed(4)).join(','),
    hourly: 'precipitation,precipitation_probability,weather_code',
    daily: 'precipitation_sum,precipitation_probability_max,weather_code,temperature_2m_max',
    timezone: 'Africa/Dakar',
    forecast_days: '3',
  });
  return u.toString();
}

export function normalise(points, payload) {
  const list = Array.isArray(payload) ? payload : [payload];
  return points.map((p, i) => {
    const d = list[i];
    const H = d.hourly;
    const D = d.daily;
    return {
      id: p.id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      hours: H.time.map((time, k) => ({ time, mm: H.precipitation[k] ?? 0, prob: H.precipitation_probability[k] ?? 0, code: H.weather_code[k] })),
      days: D.time.map((date, k) => ({ date, mm: D.precipitation_sum[k] ?? 0, prob: D.precipitation_probability_max[k] ?? 0, code: D.weather_code[k], tmax: D.temperature_2m_max[k] })),
    };
  });
}

// Should the app open in rain mode? Official vigilance, roads still flooded
// (observed rain notices / live flood reports), or >= RAIN within 12 h.
export function suggestedMode(zones, notices, now, { floodActive = false } = {}) {
  if ((notices || []).some((n) => Date.parse(n.valid_until) > now.getTime())) return 'rain';
  if (floodActive) return 'rain';
  return zones.some((z) => rank(outlook(z.hours, now, 12).risk) >= rank('RAIN')) ? 'rain' : 'joj';
}
