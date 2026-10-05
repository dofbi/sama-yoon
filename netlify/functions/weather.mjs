// GET /.netlify/functions/weather — 48 h hourly + 3-day rain forecast for the
// app's areas (Open-Meteo, CC BY 4.0). CDN-cached 30 min.
import { openMeteoUrl, normalise } from '../lib/weather.mjs';
import { ACTIVE_EVENT } from '../../src/config/event.js';

const POINTS = ACTIVE_EVENT.zones.map((z) => ({ id: z.name.toLowerCase(), name: z.name, lat: z.center[0], lng: z.center[1] }));

export default async () => {
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  try {
    const res = await fetch(openMeteoUrl(POINTS), { headers: { 'User-Agent': 'SamaYoon/0.1 (+https://samayoon.app)' } });
    if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`);
    const zones = normalise(POINTS, await res.json());
    const body = {
      zones,
      fetched_at: new Date().toISOString(),
      source: { name: 'Open-Meteo.com', url: 'https://open-meteo.com/', license: 'CC BY 4.0' },
    };
    return new Response(JSON.stringify(body), {
      headers: { ...headers, 'cache-control': 'public, max-age=600', 'netlify-cdn-cache-control': 'public, s-maxage=1800, stale-while-revalidate=600' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'source_unavailable', message: e.message }), { status: 502, headers: { ...headers, 'cache-control': 'public, max-age=60' } });
  }
};
