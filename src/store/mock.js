// Demo backend: reports live in localStorage and are broadcast to other tabs
// with BroadcastChannel, mimicking Supabase Realtime for local testing.
const KEY = 'samayoon.mock.reports';
// Reports disappear after 3 h unless re-confirmed (same rule as Supabase).
export const TTL_MS = 3 * 60 * 60 * 1000;

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
};
const write = (rows) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* storage full or blocked: keep in-memory only */
  }
};

export function createMockStore() {
  const channel = 'BroadcastChannel' in self ? new BroadcastChannel('samayoon-reports') : null;
  const listeners = new Set();
  const emit = (msg) => listeners.forEach((cb) => cb(msg));
  channel?.addEventListener('message', (e) => emit(e.data));

  const alive = () => {
    const now = Date.now();
    const rows = read().filter((r) => new Date(r.expires_at).getTime() > now);
    write(rows);
    return rows;
  };

  return {
    mode: 'mock',
    async list() {
      return alive().sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async create({ latitude, longitude, report_type, description = null }) {
      const now = new Date();
      const report = {
        id: crypto.randomUUID(),
        created_at: now.toISOString(),
        latitude,
        longitude,
        report_type,
        description,
        upvotes: 1,
        expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
      };
      write([report, ...alive()]);
      const msg = { type: 'insert', report };
      emit(msg);
      channel?.postMessage(msg);
      return report;
    },
    async upvote(id) {
      const rows = alive();
      const r = rows.find((x) => x.id === id);
      if (!r) return null;
      r.upvotes += 1;
      r.expires_at = new Date(Math.max(new Date(r.expires_at).getTime(), Date.now() + TTL_MS)).toISOString();
      write(rows);
      const msg = { type: 'update', report: r };
      emit(msg);
      channel?.postMessage(msg);
      return r;
    },
    async listWeatherNotices() {
      return [];
    },
    subscribeWeather() {
      return () => {};
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
