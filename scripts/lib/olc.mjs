// Minimal Open Location Code (Plus Code) decoder, enough to resolve the short
// codes published by the Dakar 2026 ticketing site ("MGWQ+QHG") against a
// reference point. Spec: https://github.com/google/open-location-code
const ALPHABET = '23456789CFGHJMPQRVWX';
const PAIR_RES = [20, 1, 0.05, 0.0025, 0.000125];

function encodePairs(lat, lng, length) {
  let la = Math.min(Math.max(lat, -90), 89.9999999) + 90;
  let ln = ((lng + 180) % 360 + 360) % 360;
  let code = '';
  for (let i = 0; i < length / 2; i++) {
    const r = PAIR_RES[i];
    const dLa = Math.floor(la / r);
    const dLn = Math.floor(ln / r);
    la -= dLa * r;
    ln -= dLn * r;
    code += ALPHABET[dLa] + ALPHABET[dLn];
  }
  return code;
}

export function decode(code) {
  const clean = code.replace('+', '').toUpperCase().replace(/0+$/, '');
  let lat = -90, lng = -180;
  let latRes = 0, lngRes = 0;
  for (let i = 0; i < Math.min(clean.length, 10); i += 2) {
    const r = PAIR_RES[i / 2];
    lat += ALPHABET.indexOf(clean[i]) * r;
    lng += ALPHABET.indexOf(clean[i + 1]) * r;
    latRes = lngRes = r;
  }
  for (let i = 10; i < clean.length; i++) {
    const v = ALPHABET.indexOf(clean[i]);
    latRes /= 5;
    lngRes /= 4;
    lat += Math.floor(v / 4) * latRes;
    lng += (v % 4) * lngRes;
  }
  return { lat: lat + latRes / 2, lng: lng + lngRes / 2 };
}

export function recoverNearest(short, refLat, refLng) {
  const sep = short.indexOf('+');
  const padding = 8 - sep;
  if (padding <= 0) return decode(short);
  const resolution = Math.pow(20, 2 - padding / 2);
  const half = resolution / 2;
  const prefix = encodePairs(refLat, refLng, 10).slice(0, padding);
  let { lat, lng } = decode(prefix + short);
  if (refLat + half < lat && lat - resolution >= -90) lat -= resolution;
  else if (refLat - half > lat && lat + resolution <= 90) lat += resolution;
  if (refLng + half < lng) lng -= resolution;
  else if (refLng - half > lng) lng += resolution;
  return { lat, lng };
}
