// Parser + aggregator for the official Blaise-Diagne (AIBD) flight board
// (dakaraeroport.com, operated by LAS). Shared by the data scraper and the
// Netlify function so both read the board the same way.
//
// The board only lists the current day. Endpoint used by the site itself:
//   /fr/vols?fil=1&menu=<29 arrivals | 28 departures>&page=<n>
export const AIBD_BASE = 'https://dakaraeroport.com';
export const BOARD = { arrivals: 29, departures: 28 };
export const boardUrl = (kind, page) => `${AIBD_BASE}/fr/vols?fil=1&menu=${BOARD[kind]}&page=${page}`;

const FIELDS = {
  'Date:': 'date',
  'Prévu:': 'scheduled',
  'Estimé:': 'estimated',
  'Statut:': 'status',
  'Vol:': 'flight',
  'Provenance:': 'city',
  'Destination:': 'city',
};

const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/g, ' ');
const text = (html) => decode(html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function parseBoard(html) {
  const rows = [];
  for (const block of html.split(/<div class="flights-table__row\s/).slice(1)) {
    const row = {};
    for (const m of block.matchAll(/data-table-title="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)) {
      const key = FIELDS[m[1]];
      if (key) row[key] = text(m[2]);
      if (m[1].startsWith('Compagnie')) row.airline = m[2].match(/airline\/\d+\/\d+_([a-z0-9-]+)\.\w+/i)?.[1]?.replace(/-/g, ' ') || null;
    }
    if (!row.flight || !/^\d{2}\.\d{2}\.\d{4}$/.test(row.date || '')) continue;
    const [d, mo, y] = row.date.split('.');
    row.date = `${y}-${mo}-${d}`;
    row.status = (row.status || '').toLowerCase();
    rows.push(row);
  }
  return rows;
}

const CANCELLED = /annul/;
const DELAYED = /retard/;

// Aggregate one day of arrivals + departures into hourly movements.
export function summarize({ arrivals, departures }, day) {
  const sameDay = (r) => !day || r.date === day;
  const arr = arrivals.filter(sameDay);
  const dep = departures.filter(sameDay);
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, arrivals: 0, departures: 0 }));
  for (const [list, key] of [[arr, 'arrivals'], [dep, 'departures']]) {
    for (const r of list) {
      if (CANCELLED.test(r.status)) continue;
      const h = +(r.estimated || r.scheduled || '').slice(0, 2);
      if (h >= 0 && h < 24) hours[h][key]++;
    }
  }
  const total = (h) => h.arrivals + h.departures;
  const peak = hours.reduce((a, h) => (total(h) > total(a) ? h : a), hours[0]);
  const all = [...arr, ...dep];
  return {
    day: day || arr[0]?.date || dep[0]?.date || null,
    arrivals: arr.filter((r) => !CANCELLED.test(r.status)).length,
    departures: dep.filter((r) => !CANCELLED.test(r.status)).length,
    delayed: all.filter((r) => DELAYED.test(r.status)).length,
    cancelled: all.filter((r) => CANCELLED.test(r.status)).length,
    peak_hour: total(peak) ? peak.hour : null,
    hours,
  };
}

// Busiest contiguous windows (>= threshold share of the daily peak).
export function peakWindows(hours, { share = 0.6, minLen = 2 } = {}) {
  const total = hours.map((h) => h.arrivals + h.departures);
  const max = Math.max(...total);
  if (!max) return [];
  const out = [];
  let start = null;
  total.forEach((v, h) => {
    const hot = v >= max * share;
    if (hot && start === null) start = h;
    if ((!hot || h === 23) && start !== null) {
      const end = hot && h === 23 ? 24 : h;
      if (end - start >= minLen - 1) out.push([start, end]);
      start = null;
    }
  });
  return out.map(([s, e]) => [`${String(Math.max(0, s - 1)).padStart(2, '0')}:00`, e >= 24 ? '23:59' : `${String(Math.min(24, e + 1)).padStart(2, '0')}:00`.replace('24:00', '23:59')]);
}

// Fetch every page of one board (stops when a page adds no new row).
export async function fetchBoard(kind, { fetchImpl = fetch, maxPages = 8, delayMs = 0, headers = {} } = {}) {
  const seen = new Map();
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchImpl(boardUrl(kind, page), { headers });
    if (!res.ok) throw new Error(`AIBD ${kind} page ${page}: HTTP ${res.status}`);
    const rows = parseBoard(await res.text());
    const before = seen.size;
    for (const r of rows) seen.set(`${r.date}|${r.scheduled}|${r.flight}`, r);
    if (seen.size === before) break;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
  return [...seen.values()];
}
