// Server-side helpers for the push functions: Supabase REST with the
// service_role key (Netlify env only), site datasets, and web-push sending.
import webpush from 'web-push';

const env = (k) => process.env[k] || '';
const supabaseUrl = () => env('SUPABASE_URL') || env('VITE_SUPABASE_URL').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

export function assertConfigured() {
  const missing = ['SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].filter((k) => !env(k));
  if (!supabaseUrl()) missing.push('VITE_SUPABASE_URL');
  if (missing.length) throw new Error(`missing_env:${missing.join(',')}`);
}

export async function db(path, { method = 'GET', body, prefer } = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const e = new Error(`supabase ${method} ${path.split('?')[0]}: ${res.status} ${text.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  return text ? JSON.parse(text) : null;
}

export async function siteJson(file, origin) {
  const base = origin || env('URL') || 'https://sama-yoon.netlify.app';
  const res = await fetch(`${base}/data/events/${env('VITE_EVENT') || 'jojdakar2026'}/${file}`);
  if (!res.ok) throw new Error(`dataset ${file}: HTTP ${res.status}`);
  return res.json();
}

let vapidReady = false;
function vapid() {
  if (!vapidReady) {
    webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:contact@sama-yoon.netlify.app', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
    vapidReady = true;
  }
}

// Returns 'ok' | 'gone' (subscription expired: delete it) | 'failed'.
export async function sendPush(sub, payload) {
  vapid();
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3 * 3600, urgency: 'high' });
    return 'ok';
  } catch (e) {
    return e.statusCode === 404 || e.statusCode === 410 ? 'gone' : 'failed';
  }
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
