// Event-specific settings. To reuse Sama Yoon for another event (Magal, Gamou,
// end-of-year rush, road works…), add public/data/events/<slug>/ via
// scripts/build-data.mjs and a new entry here, then switch ACTIVE_EVENT.
export const EVENTS = {
  jojdakar2026: {
    slug: 'jojdakar2026',
    name: 'JOJ Dakar 2026',
    longName: 'Jeux Olympiques de la Jeunesse Dakar 2026',
    startDate: '2026-10-30',
    endDate: '2026-11-13',
    // Day suggested before the Games start (opening ceremony).
    highlightDate: '2026-10-31',
    // Dakar is UTC+0 all year, so ISO dates/times in the data are local times.
    timezoneOffsetMinutes: 0,
    map: { center: [14.6937, -17.4441], zoom: 13, minZoom: 9 },
    staleAfterHours: 72,
  },
};

export const ACTIVE_EVENT = EVENTS[import.meta.env.VITE_EVENT || 'jojdakar2026'];

export const dataUrl = (file) => `${import.meta.env.BASE_URL}data/events/${ACTIVE_EVENT.slug}/${file}`;
