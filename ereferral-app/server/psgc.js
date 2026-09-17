const https = require('https');
const { URL } = require('url');
const psgcLocal = require('./psgc-local');

const PSGC_SYSTEM =
  process.env.PSGC_SYSTEM || 'https://psa.gov.ph/classification/psgc';
/** Pin to PSA publication quarter used by local catalog / CDR validation. */
const PSGC_VERSION = process.env.PSGC_VERSION || '1Q-2026';
const PSGC_SYSTEM_VERSIONED = `${PSGC_SYSTEM}|${PSGC_VERSION}`;
const SNOMED_SYSTEM = 'http://snomed.info/sct';
/** Clinical finding descendants - faster than expanding all of SNOMED CT. */
const SNOMED_CLINICAL_FINDING_VS = `${SNOMED_SYSTEM}?fhir_vs=isa/404684003`;
/**
 * CDR validates PractitionerRole.code against DOH Practitioner Role VS.
 * Only these codes are accepted by https://cdr.pheref.fhirlab.net/fhir
 */
const PRACTITIONER_ROLE_VS =
  process.env.PRACTITIONER_ROLE_VS ||
  'https://www.fhir.doh.gov.ph/pheref/ValueSet/practitioner-role';
/** Connectathon AC 0.02 - Referral Category (Emergency / Outpatient). */
const REFERRAL_CATEGORY_VS =
  process.env.REFERRAL_CATEGORY_VS ||
  'https://www.fhir.doh.gov.ph/pheref/ValueSet/referral-category';
const TX_BASE_URL = (
  process.env.TX_BASE_URL || 'https://tx.fhirlab.net/fhir'
).replace(/\/$/, '');
const TX_TIMEOUT_MS = Number(process.env.TX_TIMEOUT_MS) || 90000;

/** Exact DOH Referral Category VS members (fallback if TX expand fails). */
const FALLBACK_REFERRAL_CATEGORIES = [
  { system: SNOMED_SYSTEM, code: '73770003', display: 'Emergency' },
  { system: SNOMED_SYSTEM, code: '440655000', display: 'Outpatient' },
];

/** Exact DOH Practitioner Role VS members (fallback if TX expand fails). */
const FALLBACK_PRACTITIONER_ROLES = [
  { system: SNOMED_SYSTEM, code: '158965000', display: 'Doctor' },
  { system: SNOMED_SYSTEM, code: '265937000', display: 'Nurse' },
  { system: SNOMED_SYSTEM, code: '309453006', display: 'Midwife' },
  { system: SNOMED_SYSTEM, code: '46255001', display: 'Pharmacist' },
  { system: SNOMED_SYSTEM, code: '386629007', display: 'Medical Technologist' },
  { system: SNOMED_SYSTEM, code: '159282002', display: 'Laboratory Aide' },
  { system: SNOMED_SYSTEM, code: '106289002', display: 'Dentist' },
  { system: SNOMED_SYSTEM, code: '4162009', display: 'Dental Aide' },
  { system: SNOMED_SYSTEM, code: '28229004', display: 'Optometrist' },
  {
    system: 'https://fhir.doh.gov.ph/phcore/CodeSystem/PSOC',
    code: '3253',
    display: 'Barangay health worker',
  },
  {
    system: 'https://fhir.doh.gov.ph/phcore/CodeSystem/PHCW',
    code: 'PCW',
    display: 'Primary Care Worker',
  },
];

const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * PSA PSGC publication datafile - 1Q 2026 (18 regions).
 * Source: https://psa.gov.ph/classification/psgc
 * Local JSON under server/psgc-data is authoritative for cascade; TX may only
 * expose a subset (e.g. Region XII on 2Q-2026).
 */
const PSGC_REGIONS_1Q_2026 = [
  { code: '1300000000', display: 'National Capital Region (NCR)' },
  { code: '1400000000', display: 'Cordillera Administrative Region (CAR)' },
  { code: '0100000000', display: 'Region I (Ilocos Region)' },
  { code: '0200000000', display: 'Region II (Cagayan Valley)' },
  { code: '0300000000', display: 'Region III (Central Luzon)' },
  { code: '0400000000', display: 'Region IV-A (CALABARZON)' },
  { code: '1700000000', display: 'MIMAROPA Region' },
  { code: '0500000000', display: 'Region V (Bicol Region)' },
  { code: '0600000000', display: 'Region VI (Western Visayas)' },
  { code: '1800000000', display: 'Negros Island Region (NIR)' },
  { code: '0700000000', display: 'Region VII (Central Visayas)' },
  { code: '0800000000', display: 'Region VIII (Eastern Visayas)' },
  { code: '0900000000', display: 'Region IX (Zamboanga Peninsula)' },
  { code: '1000000000', display: 'Region X (Northern Mindanao)' },
  { code: '1100000000', display: 'Region XI (Davao Region)' },
  { code: '1200000000', display: 'Region XII (SOCCSKSARGEN)' },
  { code: '1600000000', display: 'Region XIII (Caraga)' },
  {
    code: '1900000000',
    display: 'Bangsamoro Autonomous Region In Muslim Mindanao (BARMM)',
  },
];

const PSGC_RELEASE = process.env.PSGC_VERSION || psgcLocal.RELEASE || '1Q-2026';

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

function txFetch(path, { method = 'GET', body } = {}) {
  const url = new URL(`${TX_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`);
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers: {
          Accept: 'application/fhir+json',
          ...(payload
            ? {
                'Content-Type': 'application/fhir+json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
        timeout: TX_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = {
              resourceType: 'OperationOutcome',
              issue: [{ diagnostics: text }],
            };
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const msg =
              data?.issue?.[0]?.diagnostics ||
              data?.issue?.[0]?.details?.text ||
              `Terminology request failed (${res.statusCode})`;
            const err = new Error(msg);
            err.status = res.statusCode;
            err.data = data;
            reject(err);
            return;
          }
          resolve(data);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      const err = new Error(`Terminology request timed out after ${TX_TIMEOUT_MS}ms`);
      err.status = 504;
      reject(err);
    });
    req.on('error', (err) => {
      const detail = err.code ? `${err.message} (${err.code})` : err.message || 'Terminology request failed';
      const wrapped = new Error(detail);
      wrapped.status = 502;
      wrapped.cause = err;
      reject(wrapped);
    });

    if (payload) req.write(payload);
    req.end();
  });
}

function parseLookup(parameters) {
  const out = {
    code: null,
    display: null,
    system: PSGC_SYSTEM,
    version: null,
    children: [],
    inactive: false,
  };
  for (const p of parameters || []) {
    if (p.name === 'code') out.code = p.valueCode || null;
    if (p.name === 'display') out.display = p.valueString || null;
    if (p.name === 'system') out.system = p.valueUri || out.system;
    if (p.name === 'version') out.version = p.valueString || null;
    if (p.name === 'property' && Array.isArray(p.part)) {
      const code = p.part.find((x) => x.name === 'code')?.valueCode;
      const valuePart = p.part.find((x) => x.name === 'value');
      const value =
        valuePart?.valueCode ??
        valuePart?.valueString ??
        valuePart?.valueBoolean ??
        null;
      if (code === 'child' && value) out.children.push(String(value));
      if (code === 'inactive') out.inactive = Boolean(value);
    }
  }
  return out;
}

function toOption(code, display) {
  const label = display || code;
  return { id: code, text: label, code, display: label };
}

async function lookupCodeTx(code) {
  const data = await txFetch('/CodeSystem/$lookup', {
    method: 'POST',
    body: {
      resourceType: 'Parameters',
      parameter: [
        { name: 'system', valueUri: PSGC_SYSTEM },
        { name: 'version', valueString: PSGC_VERSION },
        { name: 'code', valueCode: String(code) },
      ],
    },
  });
  return parseLookup(data.parameter);
}

async function lookupCode(code) {
  const key = `lookup:${code}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const local = psgcLocal.lookupLocal(code);
  if (local) return cacheSet(key, local);

  try {
    return cacheSet(key, await lookupCodeTx(code));
  } catch (err) {
    const errOut = new Error(err.message || `PSGC code not found: ${code}`);
    errOut.status = err.status || 404;
    throw errOut;
  }
}

async function resolveOptions(codes) {
  const unique = [...new Set(codes.filter(Boolean).map(String))];
  const results = await Promise.all(
    unique.map(async (code) => {
      try {
        const item = await lookupCode(code);
        return toOption(item.code || code, item.display);
      } catch {
        return toOption(code, code);
      }
    })
  );
  return results;
}

async function searchConcepts(q, count = 20) {
  const query = String(q || '').trim();
  if (query.length < 2) return [];

  const key = `search:${query.toLowerCase()}:${count}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await txFetch('/ValueSet/$expand', {
    method: 'POST',
    body: {
      resourceType: 'Parameters',
      parameter: [
        {
          name: 'valueSet',
          resource: {
            resourceType: 'ValueSet',
            status: 'active',
            compose: { include: [{ system: PSGC_SYSTEM }] },
          },
        },
        { name: 'filter', valueString: query },
        { name: 'count', valueInteger: Math.min(50, Math.max(1, Number(count) || 20)) },
      ],
    },
  });

  const contains = data?.expansion?.contains || [];
  const results = contains.map((c) => toOption(c.code, c.display));
  return cacheSet(key, results);
}

async function getChildren(parentCode) {
  const parent = String(parentCode || '').trim();
  if (!parent) return { parent: null, results: [] };

  const key = `children:${parent}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  // Prefer local hierarchy: TX PSGC currently only covers a subset of regions.
  const localHit = psgcLocal.lookupLocal(parent);
  if (localHit) {
    const local = psgcLocal.getLocalChildren(parent);
    return cacheSet(key, {
      parent: local.parent,
      results: local.results,
      source: 'local',
    });
  }

  const looked = await lookupCode(parent);
  const results = await resolveOptions(looked.children);
  return cacheSet(key, {
    parent: toOption(looked.code || parent, looked.display),
    results,
    source: looked.source || 'tx',
  });
}

function listRegions(q = '') {
  try {
    return psgcLocal.listRegions(q);
  } catch {
    const query = String(q || '').trim().toLowerCase();
    const all = PSGC_REGIONS_1Q_2026.map((r) => toOption(r.code, r.display));
    if (!query) return all;
    return all.filter(
      (r) =>
        r.display.toLowerCase().includes(query) ||
        r.code.includes(query) ||
        r.text.toLowerCase().includes(query)
    );
  }
}

function findRegion(code) {
  const key = String(code || '').trim();
  if (!key) return null;
  const local = psgcLocal.lookupLocal(key);
  if (local?.level === 'region') return toOption(local.code, local.display);
  const hit = PSGC_REGIONS_1Q_2026.find((r) => r.code === key);
  return hit ? toOption(hit.code, hit.display) : null;
}

async function checkTx() {
  const data = await txFetch(`/CodeSystem/PSGC?_elements=id,url,count,status,version`);
  return {
    status: 'connected',
    baseUrl: TX_BASE_URL,
    system: data.url || PSGC_SYSTEM,
    count: data.count ?? null,
    version: data.version || null,
  };
}

/** Connectathon-friendly local catalog when TX is down or slow. */
const LOCAL_DIAGNOSES = [
  { code: '25064002', display: 'Headache' },
  { code: '398254007', display: 'Pre-eclampsia' },
  { code: '48194001', display: 'Pregnancy-induced hypertension' },
  { code: '77386006', display: 'Pregnant' },
  { code: '38341003', display: 'Hypertensive disorder' },
  { code: '73211009', display: 'Diabetes mellitus' },
  { code: '44054006', display: 'Diabetes mellitus type 2' },
  { code: '46635009', display: 'Diabetes mellitus type 1' },
  { code: '195967001', display: 'Asthma' },
  { code: '13645005', display: 'Chronic obstructive lung disease' },
  { code: '22298006', display: 'Myocardial infarction' },
  { code: '84114007', display: 'Heart failure' },
  { code: '42343007', display: 'Congestive heart failure' },
  { code: '49436004', display: 'Atrial fibrillation' },
  { code: '230690007', display: 'Cerebrovascular accident' },
  { code: '271737000', display: 'Anemia' },
  { code: '386661006', display: 'Fever' },
  { code: '49727002', display: 'Cough' },
  { code: '267036007', display: 'Dyspnea' },
  { code: '422587007', display: 'Nausea' },
  { code: '422400008', display: 'Vomiting' },
  { code: '21522001', display: 'Abdominal pain' },
  { code: '29857009', display: 'Chest pain' },
  { code: '62315008', display: 'Diarrhea' },
  { code: '84229001', display: 'Fatigue' },
  { code: '271594007', display: 'Syncope' },
  { code: '40930008', display: 'Hypothyroidism' },
  { code: '709044004', display: 'Chronic kidney disease' },
  { code: '90708001', display: 'Kidney disease' },
  { code: '235595009', display: 'Gastroesophageal reflux disease' },
  { code: '266569009', display: 'Gastroenteritis' },
  { code: '68566005', display: 'Urinary tract infectious disease' },
  { code: '233604007', display: 'Pneumonia' },
  { code: '36971009', display: 'Sinusitis' },
  { code: '65363002', display: 'Otitis media' },
  { code: '46775006', display: 'Respiratory distress syndrome in newborn' },
];

function toDiagnosisResult(code, display, system = SNOMED_SYSTEM, extras = {}) {
  const label = display || code;
  return {
    id: code,
    code,
    display: label,
    system,
    snomedCode: extras.snomedCode || code,
    icdCode: extras.icdCode || null,
    icdDisplay: extras.icdDisplay || null,
    // Selected/closed label: diagnosis name only (no leading code).
    text: label,
  };
}

function searchLocalDiagnoses(q, count = 20) {
  const query = String(q || '').trim().toLowerCase();
  if (query.length < 2) return [];
  return LOCAL_DIAGNOSES.filter(
    (d) =>
      d.display.toLowerCase().includes(query) ||
      d.code.includes(query) ||
      `${d.code} - ${d.display}`.toLowerCase().includes(query)
  )
    .slice(0, Math.min(50, Math.max(1, Number(count) || 20)))
    .map((d) => toDiagnosisResult(d.code, d.display));
}

async function expandValueSet(filter, count, valueSetUrl) {
  return txFetch('/ValueSet/$expand', {
    method: 'POST',
    body: {
      resourceType: 'Parameters',
      parameter: [
        { name: 'url', valueUri: valueSetUrl },
        { name: 'filter', valueString: filter },
        { name: 'count', valueInteger: Math.min(50, Math.max(1, Number(count) || 20)) },
      ],
    },
  });
}

async function searchDiagnoses(q, count = 20) {
  const query = String(q || '').trim();
  if (query.length < 2) return [];

  const key = `dx:${query.toLowerCase()}:${count}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    let data;
    try {
      data = await expandValueSet(query, count, SNOMED_CLINICAL_FINDING_VS);
    } catch {
      data = await expandValueSet(query, count, `${SNOMED_SYSTEM}?fhir_vs`);
    }

    const contains = data?.expansion?.contains || [];
    const results = contains.map((c) =>
      toDiagnosisResult(c.code, c.display || c.code, c.system || SNOMED_SYSTEM)
    );
    if (results.length) return cacheSet(key, results);
  } catch (err) {
    // TX down/unavailable: fall through to local catalog
    console.warn('[diagnoses] TX search failed, using local catalog:', err.message);
  }

  const local = searchLocalDiagnoses(query, count);
  return cacheSet(key, local);
}

function toPractitionerRoleOption(c, extras = {}) {
  const code = String(c.code || '').trim();
  const display = String(c.display || code).trim();
  const system = String(c.system || SNOMED_SYSTEM).trim();
  return {
    id: `${code}|${display}`,
    code,
    display,
    system,
    text: display,
    suggested: Boolean(extras.suggested),
  };
}

function searchLocalPractitionerRoles(q, count = 25) {
  const query = String(q || '').trim().toLowerCase();
  const all = FALLBACK_PRACTITIONER_ROLES.map((c) =>
    toPractitionerRoleOption(c, { suggested: true })
  );
  if (!query) return all.slice(0, Math.min(50, Math.max(1, Number(count) || 25)));
  return all
    .filter(
      (r) =>
        r.display.toLowerCase().includes(query) ||
        r.code.includes(query) ||
        `${r.code} ${r.display}`.toLowerCase().includes(query)
    )
    .slice(0, Math.min(50, Math.max(1, Number(count) || 25)));
}

/**
 * Practitioner roles allowed by CDR: DOH Practitioner Role ValueSet.
 * Empty query returns the full VS; typed query filters within that VS.
 */
async function searchPractitionerRoles(q, count = 50) {
  const query = String(q || '').trim();
  const limit = Math.min(50, Math.max(1, Number(count) || 50));
  const key = `prac-role-vs:${query.toLowerCase() || '_'}:${limit}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    let data;
    if (query.length >= 1) {
      data = await expandValueSet(query, limit, PRACTITIONER_ROLE_VS);
    } else {
      data = await txFetch(
        `/ValueSet/$expand?url=${encodeURIComponent(PRACTITIONER_ROLE_VS)}&count=${limit}`
      );
    }
    const contains = data?.expansion?.contains || [];
    const results = contains
      .filter((c) => c?.code)
      .map((c) => toPractitionerRoleOption(c, { suggested: !query }));
    if (results.length) {
      return cacheSet(key, {
        source: 'tx',
        valueSet: PRACTITIONER_ROLE_VS,
        total: data?.expansion?.total ?? results.length,
        results,
      });
    }
  } catch (err) {
    console.warn('[practitioner-roles] TX expand failed, using fallback:', err.message);
  }

  const results = searchLocalPractitionerRoles(query, limit);
  return cacheSet(key, {
    source: 'fallback',
    valueSet: PRACTITIONER_ROLE_VS,
    total: results.length,
    results,
  });
}

async function listPractitionerRoles() {
  return searchPractitionerRoles('', 50);
}

function toReferralCategoryOption(c) {
  const code = String(c.code || '').trim();
  const display = String(c.display || code).trim();
  const system = String(c.system || SNOMED_SYSTEM).trim();
  return {
    id: code,
    code,
    display,
    system,
    text: display,
  };
}

/**
 * Referral priority / category options from DOH referral-category ValueSet.
 * Empty query returns the full VS (Emergency, Outpatient).
 */
async function listReferralCategories() {
  const key = 'referral-category-vs';
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const data = await txFetch(
      `/ValueSet/$expand?url=${encodeURIComponent(REFERRAL_CATEGORY_VS)}&count=20`
    );
    const contains = data?.expansion?.contains || [];
    const results = contains
      .filter((c) => c?.code)
      .map((c) => toReferralCategoryOption(c));
    if (results.length) {
      return cacheSet(key, {
        source: 'tx',
        valueSet: REFERRAL_CATEGORY_VS,
        total: data?.expansion?.total ?? results.length,
        results,
      });
    }
  } catch (err) {
    console.warn('[referral-categories] TX expand failed, using fallback:', err.message);
  }

  const results = FALLBACK_REFERRAL_CATEGORIES.map((c) => toReferralCategoryOption(c));
  return cacheSet(key, {
    source: 'fallback',
    valueSet: REFERRAL_CATEGORY_VS,
    total: results.length,
    results,
  });
}

module.exports = {
  PSGC_SYSTEM,
  PSGC_VERSION,
  PSGC_SYSTEM_VERSIONED,
  PSGC_RELEASE,
  PSGC_REGIONS_1Q_2026,
  SNOMED_SYSTEM,
  PRACTITIONER_ROLE_VS,
  REFERRAL_CATEGORY_VS,
  TX_BASE_URL,
  lookupCode,
  searchConcepts,
  searchDiagnoses,
  searchPractitionerRoles,
  listPractitionerRoles,
  listReferralCategories,
  getChildren,
  listRegions,
  findRegion,
  resolveOptions,
  toOption,
  checkTx,
};
