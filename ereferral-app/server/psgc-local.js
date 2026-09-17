const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'psgc-data');
const RELEASE = '1Q-2026';
const SOURCE = 'https://psa.gov.ph/classification/psgc';

let loaded = null;

function readJson(name) {
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing PSGC data file: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function toOption(code, display) {
  const label = display || code;
  return { id: code, text: label, code, display: label };
}

function sortByName(a, b) {
  return String(a.display || a.name || '').localeCompare(
    String(b.display || b.name || ''),
    'en',
    { sensitivity: 'base' }
  );
}

/**
 * Build parent -> children indexes from PSA PSGC publication JSON (1Q 2026).
 * Province/city FK prefixes in the source files are short and can collide
 * (e.g. 1102 for both Davao del Norte and Davao del Sur), so hierarchy uses
 * 10-digit code prefixes instead.
 */
function buildIndex() {
  const regions = readJson('regions.json');
  const provinces = readJson('provinces.json');
  const cities = readJson('cities_municipalities.json');
  const barangays = readJson('barangays.json');

  const byCode = new Map();
  const childrenOf = new Map();

  function addNode(code, display, level) {
    byCode.set(code, { code, display, level });
  }

  function addChild(parentCode, child) {
    if (!parentCode || !child?.code) return;
    if (!childrenOf.has(parentCode)) childrenOf.set(parentCode, []);
    childrenOf.get(parentCode).push(child);
  }

  for (const r of regions) {
    addNode(r.code, r.name, 'region');
  }
  for (const p of provinces) {
    addNode(p.code, p.name, 'province');
  }
  for (const c of cities) {
    addNode(c.code, c.name, 'city');
  }
  for (const b of barangays) {
    addNode(b.code, b.name, 'barangay');
  }

  const provincePrefixes = provinces.map((p) => p.code.slice(0, 5));
  const citiesByPrefix7 = new Map(
    cities.map((c) => [c.code.slice(0, 7), c])
  );

  function isUnderAnyProvince(cityCode) {
    return provincePrefixes.some((prefix) => cityCode.startsWith(prefix));
  }

  for (const p of provinces) {
    const regionCode = `${String(p.region_code || p.code.slice(0, 2)).padStart(2, '0')}00000000`;
    addChild(regionCode, toOption(p.code, p.name));
  }

  for (const c of cities) {
    const regionCode = `${c.code.slice(0, 2)}00000000`;
    if (!isUnderAnyProvince(c.code)) {
      // HUC / independent city: selectable at province level
      addChild(regionCode, toOption(c.code, c.name));
      continue;
    }
    const parentProvince = provinces.find((p) => c.code.startsWith(p.code.slice(0, 5)));
    if (parentProvince) {
      addChild(parentProvince.code, toOption(c.code, c.name));
    }
  }

  for (const b of barangays) {
    // 10-digit PSGC: RR PP CC BBBB - city/municipality is identified by the
    // first 7 digits when matching barangay codes (FK fields are truncated).
    const cityKey = b.code.slice(0, 7);
    const parentCity = citiesByPrefix7.get(cityKey);
    if (parentCity) {
      addChild(parentCity.code, toOption(b.code, b.name));
    }
  }

  for (const [parent, kids] of childrenOf.entries()) {
    kids.sort(sortByName);
    // de-dupe by code
    const seen = new Set();
    childrenOf.set(
      parent,
      kids.filter((k) => {
        if (seen.has(k.code)) return false;
        seen.add(k.code);
        return true;
      })
    );
  }

  return {
    release: RELEASE,
    source: SOURCE,
    byCode,
    childrenOf,
    regions: regions.map((r) => toOption(r.code, r.name)),
    stats: {
      regions: regions.length,
      provinces: provinces.length,
      cities: cities.length,
      barangays: barangays.length,
    },
  };
}

function ensureLoaded() {
  if (!loaded) {
    loaded = buildIndex();
    console.log(
      `[psgc-local] loaded ${RELEASE}: ${loaded.stats.regions} regions, ${loaded.stats.provinces} provinces, ${loaded.stats.cities} cities/municipalities, ${loaded.stats.barangays} barangays`
    );
  }
  return loaded;
}

function listRegions(q = '') {
  const { regions } = ensureLoaded();
  const query = String(q || '').trim().toLowerCase();
  if (!query) return regions.slice();
  return regions.filter(
    (r) =>
      r.display.toLowerCase().includes(query) ||
      r.code.includes(query) ||
      r.text.toLowerCase().includes(query)
  );
}

function lookupLocal(code) {
  const key = String(code || '').trim();
  if (!key) return null;
  const idx = ensureLoaded();
  const node = idx.byCode.get(key);
  if (!node) return null;
  const children = (idx.childrenOf.get(key) || []).map((c) => c.code);
  return {
    code: node.code,
    display: node.display,
    system: SOURCE,
    version: RELEASE,
    children,
    inactive: false,
    level: node.level,
    source: 'local',
  };
}

function getLocalChildren(parentCode) {
  const key = String(parentCode || '').trim();
  if (!key) return { parent: null, results: [] };
  const idx = ensureLoaded();
  const node = idx.byCode.get(key);
  const parent = node
    ? toOption(node.code, node.display)
    : toOption(key, key);
  const results = idx.childrenOf.get(key) || [];
  return { parent, results: results.slice(), source: 'local' };
}

function hasLocalData() {
  try {
    ensureLoaded();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  RELEASE,
  SOURCE,
  listRegions,
  lookupLocal,
  getLocalChildren,
  hasLocalData,
  ensureLoaded,
};
