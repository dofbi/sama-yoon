// Inline SVG icon set ("L'Aventure Urbaine"). No network requests; each icon
// is a function returning markup so colours can follow the traffic state.
const svg = (body, { size = 32, vb = '0 0 32 32', cls = '' } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vb}" class="${cls}" aria-hidden="true" focusable="false">${body}</svg>`;

export const icons = {
  // Car rapide: yellow/blue Dakar minibus with its painted bands.
  carRapide: (o = {}) =>
    svg(
      `<path d="M3 21V12.5C3 10 4.6 8 7 8h15.5c2 0 3.4 1 4.3 2.8L29 15.5V21z" fill="#F4C430" stroke="#3B2314" stroke-width="1.4" stroke-linejoin="round"/>
       <path d="M3 17h26" stroke="#1F4FA0" stroke-width="2.4"/>
       <path d="M6 11h5v4H6zM12.5 11h5v4h-5zM19 11h4.5l2 4H19z" fill="#CFE3F0" stroke="#3B2314" stroke-width="1"/>
       <path d="M8 19.2l2-1 2 1 2-1 2 1 2-1 2 1" fill="none" stroke="#B3261E" stroke-width="1"/>
       <circle cx="9" cy="22" r="2.6" fill="#3B2314"/><circle cx="23" cy="22" r="2.6" fill="#3B2314"/>
       <circle cx="9" cy="22" r="1" fill="#F2E3C6"/><circle cx="23" cy="22" r="1" fill="#F2E3C6"/>`,
      o,
    ),
  baobab: (o = {}) =>
    svg(
      `<path d="M13.5 29c.8-4 .9-8.5.4-12.5h4.2c-.5 4-.4 8.5.4 12.5z" fill="#8B4A2B" stroke="#3B2314" stroke-width="1.1"/>
       <path d="M14 17c-2-1.5-4.5-2-6-4M18 17c2-1.5 4.5-2 6-4M16 16.5V12" stroke="#8B4A2B" stroke-width="1.6" fill="none" stroke-linecap="round"/>
       <path d="M4 12c-1.4-3 1.3-6 4.4-5.2C9.6 3.4 14 2.5 16 5c2-2.5 6.4-1.6 7.6 1.8C26.7 6 29.4 9 28 12c-1.4 2.2-4.5 2.3-6 1.2-1.6 1.5-4.4 1.6-6 .2-1.6 1.4-4.4 1.3-6-.2C8.5 14.3 5.4 14.2 4 12z" fill="#3F7A3A" stroke="#23451F" stroke-width="1.1"/>
       <path d="M2 29h28" stroke="#C8822B" stroke-width="1.4" stroke-dasharray="2 2"/>`,
      o,
    ),
  chest: (o = {}) =>
    svg(
      `<path d="M4 14h24v13H4z" fill="#8B4A2B" stroke="#3B2314" stroke-width="1.3"/>
       <path d="M4 14c0-5 3-8 12-8s12 3 12 8z" fill="#A65E33" stroke="#3B2314" stroke-width="1.3"/>
       <path d="M4 18h24M10 6.6V27M22 6.6V27" stroke="#C8822B" stroke-width="2"/>
       <rect x="13.5" y="16" width="5" height="6" rx="1" fill="#F4C430" stroke="#3B2314"/>
       <path d="M8 6l1-3M16 5V1.5M24 6l-1-3" stroke="#F4C430" stroke-width="1.4" stroke-linecap="round"/>`,
      o,
    ),
  medallion: (color = '#1F2F5C', glyph = '', o = {}) =>
    svg(
      `<circle cx="16" cy="16" r="13" fill="${color}" stroke="#F2E3C6" stroke-width="2.5"/>
       <circle cx="16" cy="16" r="10" fill="none" stroke="#C8822B" stroke-width="1.2" stroke-dasharray="2 1.6"/>
       <text x="16" y="20.5" text-anchor="middle" font-size="12" font-family="system-ui,sans-serif" font-weight="700" fill="#F2E3C6">${glyph}</text>`,
      o,
    ),
  train: (o = {}) =>
    svg(
      `<rect x="3" y="3" width="26" height="26" rx="7" fill="#1F2F5C"/>
       <rect x="9" y="7" width="14" height="14" rx="3" fill="#F2E3C6"/><rect x="11" y="9.5" width="10" height="5" rx="1" fill="#1F2F5C"/>
       <circle cx="12.5" cy="18" r="1.3" fill="#1F2F5C"/><circle cx="19.5" cy="18" r="1.3" fill="#1F2F5C"/>
       <path d="M11 21l-2.5 4.5M21 21l2.5 4.5" stroke="#F2E3C6" stroke-width="1.6" stroke-linecap="round"/>`,
      o,
    ),
  bus: (o = {}) =>
    svg(
      `<rect x="3" y="3" width="26" height="26" rx="7" fill="#1F6FA0"/>
       <rect x="8" y="7.5" width="16" height="15" rx="2.5" fill="#F2E3C6"/><rect x="10" y="10" width="12" height="5" rx="1" fill="#1F6FA0"/>
       <circle cx="12" cy="19" r="1.2" fill="#1F6FA0"/><circle cx="20" cy="19" r="1.2" fill="#1F6FA0"/>
       <path d="M10.5 22.5v2.5M21.5 22.5v2.5" stroke="#F2E3C6" stroke-width="2" stroke-linecap="round"/>`,
      o,
    ),
  barrier: (o = {}) =>
    svg(
      `<rect x="3" y="11" width="26" height="7" rx="1.5" fill="#F2E3C6" stroke="#3B2314" stroke-width="1.3"/>
       <path d="M7 11l-4 7M14 11l-4 7M21 11l-4 7M28 11l-4 7" stroke="#B3261E" stroke-width="3"/>
       <path d="M7 18v9M25 18v9" stroke="#3B2314" stroke-width="2"/>
       <circle cx="7" cy="8" r="2" fill="#E08A1E"/><circle cx="25" cy="8" r="2" fill="#E08A1E"/>`,
      o,
    ),
  police: (o = {}) =>
    svg(
      `<path d="M16 3l11 4v8c0 7-5 11.5-11 14C10 26.5 5 22 5 15V7z" fill="#1F2F5C" stroke="#3B2314" stroke-width="1.2"/>
       <path d="M16 9l2 4.2 4.6.6-3.4 3.2.9 4.6L16 19.4 11.9 21.6l.9-4.6-3.4-3.2 4.6-.6z" fill="#F4C430"/>`,
      o,
    ),
  renaissance: (o = {}) =>
    svg(
      `<path d="M4 29h24l-3-4H7z" fill="#8B4A2B"/>
       <path d="M13 25l1-9-3-4 2-5 2 1 1 4 3-6 2 1-2 6 2 4-2 8z" fill="#5C4033" stroke="#3B2314" stroke-width=".8"/>
       <circle cx="14" cy="5" r="1.6" fill="#5C4033"/><circle cx="19.5" cy="3.5" r="1.4" fill="#5C4033"/>`,
      o,
    ),
  mosque: (o = {}) =>
    svg(
      `<path d="M5 29V17h22v12z" fill="#F2E3C6" stroke="#3B2314" stroke-width="1.2"/>
       <path d="M9 17c0-5 3.2-7.5 7-8.5 3.8 1 7 3.5 7 8.5z" fill="#3F7A3A" stroke="#3B2314" stroke-width="1.2"/>
       <path d="M27 29V8M5 29V11" stroke="#3B2314" stroke-width="2.2"/>
       <path d="M16 8.5V5" stroke="#C8822B" stroke-width="1.4"/><path d="M13 29v-6a3 3 0 016 0v6z" fill="#8B4A2B"/>`,
      o,
    ),
  pirogue: (o = {}) =>
    svg(
      `<path d="M2 18h28c-2 5-6 7-14 7S4 23 2 18z" fill="#1F6FA0" stroke="#3B2314" stroke-width="1.2"/>
       <path d="M4 20h24" stroke="#F4C430" stroke-width="1.5"/><path d="M6 22.5h20" stroke="#B3261E" stroke-width="1.2"/>
       <path d="M16 18V4l8 11z" fill="#F2E3C6" stroke="#3B2314" stroke-width="1"/>
       <path d="M1 28c3-1.5 5 1.5 8 0s5 1.5 8 0 5 1.5 8 0 4 .6 6 0" fill="none" stroke="#1F6FA0" stroke-width="1.2"/>`,
      o,
    ),
  lighthouse: (o = {}) =>
    svg(
      `<path d="M12 29l1.5-18h5L20 29z" fill="#F2E3C6" stroke="#3B2314" stroke-width="1.2"/>
       <path d="M13 17h6M12.6 23h6.8" stroke="#B3261E" stroke-width="2.2"/>
       <path d="M12 11h8V7h-8z" fill="#F4C430" stroke="#3B2314"/><path d="M11 7l5-4 5 4z" fill="#B3261E"/>
       <path d="M20 9l9-3M20 9l9 3M12 9L3 6M12 9l-9 3" stroke="#F4C430" stroke-width="1" opacity=".8"/>`,
      o,
    ),
  thieb: (o = {}) =>
    svg(
      `<path d="M3 15h26c0 7-5.8 12-13 12S3 22 3 15z" fill="#1F2F5C" stroke="#3B2314" stroke-width="1.2"/>
       <path d="M5 15c1-3 5-5 11-5s10 2 11 5z" fill="#C8822B"/>
       <circle cx="12" cy="12.5" r="2" fill="#B3261E"/><circle cx="20" cy="12" r="2.2" fill="#E08A1E"/><path d="M15 11l3-2" stroke="#3F7A3A" stroke-width="2"/>`,
      o,
    ),
  compass: (o = {}) =>
    svg(
      `<circle cx="16" cy="16" r="13" fill="#F2E3C6" stroke="#3B2314" stroke-width="1.5"/>
       <path d="M16 5l3 11-3 11-3-11z" fill="#B3261E"/><path d="M16 16l3 0-3 11-3-11z" fill="#1F2F5C"/>
       <circle cx="16" cy="16" r="1.6" fill="#F4C430"/>`,
      o,
    ),
  share: (o = {}) =>
    svg(
      `<path d="M16 3C9 3 3.5 8.4 3.5 15c0 2.3.7 4.5 1.9 6.4L4 28l6.8-1.7A12.6 12.6 0 0016 27c7 0 12.5-5.4 12.5-12S23 3 16 3z" fill="#25A244" stroke="#F2E3C6" stroke-width="1.5"/>
       <path d="M11.5 9.8c.4-.6 1.2-.6 1.5 0l1.2 2.6c.2.4 0 .9-.3 1.2l-.8.8c.9 1.9 2.4 3.4 4.3 4.3l.8-.8c.3-.3.8-.5 1.2-.3l2.6 1.2c.6.3.6 1.1 0 1.5-1 .9-2.4 1.4-3.8.9-3.4-1.1-6.2-3.9-7.3-7.3-.5-1.4 0-2.8.6-4.1z" fill="#fff"/>`,
      o,
    ),
  locate: (o = {}) =>
    svg(
      `<circle cx="16" cy="16" r="7" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="16" cy="16" r="2.6" fill="currentColor"/>
       <path d="M16 2v6M16 24v6M2 16h6M24 16h6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
      o,
    ),
  menu: (o = {}) => svg(`<path d="M5 9h22M5 16h22M5 23h22" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`, o),
  close: (o = {}) => svg(`<path d="M8 8l16 16M24 8L8 24" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`, o),
};

// Sport glyph shown inside venue medallions.
export const venueGlyph = {
  CTO: '🏊',
  CID: '🏃',
  COR: '🚴',
  CED: '🐎',
  DAR: '🏸',
  SAW: '🏹',
  DEX: '🥋',
  SBW: '🏐',
};
