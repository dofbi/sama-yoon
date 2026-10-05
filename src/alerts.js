// Web Push subscription on this device. Preferences (zones, triggers) are
// mirrored in localStorage for display; the server copy is authoritative.
const ENDPOINT = '/.netlify/functions/alerts-subscribe';
const PREFS_KEY = 'samayoon.alerts';
const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function support() {
  if (!VAPID) return 'not_configured';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'ios_install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

export function savedPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || null;
  } catch {
    return null;
  }
}
function savePrefs(p) {
  try {
    p ? localStorage.setItem(PREFS_KEY, JSON.stringify(p)) : localStorage.removeItem(PREFS_KEY);
  } catch {
    /* private mode */
  }
}

const b64ToBytes = (b64) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export async function currentSubscription() {
  if (support() !== 'ok') return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function post(method, body) {
  const res = await fetch(ENDPOINT, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `http_${res.status}`);
  return json;
}

// Asks permission if needed, subscribes, and stores zones/triggers server-side.
export async function enable({ zones, triggers }) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('denied');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID) }));
  const res = await post('POST', { subscription: sub.toJSON(), zones, triggers });
  savePrefs({ zones: res.zones, triggers: res.triggers });
  return res;
}

export async function disable() {
  const sub = await currentSubscription();
  if (sub) {
    await post('DELETE', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  savePrefs(null);
}
