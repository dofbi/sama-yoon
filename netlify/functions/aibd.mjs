// GET /.netlify/functions/aibd — today's movements at Blaise-Diagne airport,
// read from the official board (dakaraeroport.com). The CDN caches the answer
// for 15 min, so the airport site receives at most a few requests per hour.
import { fetchBoard, summarize, peakWindows, AIBD_BASE } from '../../scripts/lib/aibd.mjs';

const UA = 'SamaYoon/0.1 (+https://sama-yoon.netlify.app; civic mobility app)';

export default async () => {
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  try {
    const opts = { maxPages: 6, delayMs: 250, headers: { 'User-Agent': UA } };
    const [arrivals, departures] = await Promise.all([fetchBoard('arrivals', opts), fetchBoard('departures', opts)]);
    // Dakar = UTC+0: the server date is the local date.
    const today = new Date().toISOString().slice(0, 10);
    const summary = summarize({ arrivals, departures }, today);
    const nowHour = new Date().getUTCHours();
    const upcoming = summary.hours.filter((h) => h.hour >= nowHour);
    const next = upcoming.reduce((a, h) => (h.arrivals + h.departures > a.arrivals + a.departures ? h : a), upcoming[0] || summary.hours[23]);
    const body = {
      ...summary,
      peak_windows: peakWindows(summary.hours),
      next_peak_hour: next && next.arrivals + next.departures ? next.hour : null,
      fetched_at: new Date().toISOString(),
      source_url: `${AIBD_BASE}/fr/vols/arrivee-vols`,
    };
    return new Response(JSON.stringify(body), {
      headers: { ...headers, 'cache-control': 'public, max-age=300', 'netlify-cdn-cache-control': 'public, s-maxage=900, stale-while-revalidate=300' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'source_unavailable', message: e.message, fetched_at: new Date().toISOString() }), {
      status: 502,
      headers: { ...headers, 'cache-control': 'public, max-age=60' },
    });
  }
};
