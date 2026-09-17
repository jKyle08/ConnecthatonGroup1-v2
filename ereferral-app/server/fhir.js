const crypto = require('crypto');
const { PSGC_SYSTEM, PSGC_VERSION, PSGC_SYSTEM_VERSIONED } = require('./psgc');

const FHIR_BASE_URL = (process.env.FHIR_BASE_URL || 'https://cdr.pheref.fhirlab.net/fhir').replace(/\/$/, '');
const PHILSYS_SYSTEM = 'http://philsys.gov.ph/fhir/Identifier/philsys-id';
const PHILHEALTH_SYSTEM = 'http://philhealth.gov.ph/fhir/Identifier/philhealth-id';
const PATIENT_PROFILE = 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-patient';
const NHFR_SYSTEM = 'https://fhir.doh.gov.ph/phcore/Identifier/doh-nhfr-code';
const HCPN_SYSTEM = 'https://fhir.doh.gov.ph/phcore/Identifier/hcpn-code';
const ORGANIZATION_PROFILE = 'https://fhir.doh.gov.ph/phcore/StructureDefinition/ph-core-organization';
const PRC_SYSTEM = 'https://prc.gov.ph/';
const PRC_SYSTEM_DOH = 'https://fhir.doh.gov.ph/phcore/Identifier/doh-prc-license-number';
const PRC_SYSTEM_ALT = 'http://prc.gov.ph/fhir/Identifier/prc-license';
const PRACTITIONER_PROFILE = 'https://fhir.doh.gov.ph/phcore/StructureDefinition/ph-core-practitioner';
const PRACTITIONER_ROLE_PROFILE =
  'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-practitioner-role';
const SERVICE_REQUEST_PROFILE =
  'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-service-request';
const TASK_PROFILE = 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-task';
const ENCOUNTER_PROFILE = 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-encounter';
const CONDITION_PROFILE = 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-condition';
const OBSERVATION_PROFILE = 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-observation';
const PROCEDURE_PROFILE = 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-procedure';
const DIAGNOSTIC_REPORT_PROFILE =
  'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-diagnostic-report';
const REQUISITION_SYSTEM = 'urn:oid:1.2.840.113619.21.1.2';
const SNOMED_SYSTEM = 'http://snomed.info/sct';
const DEFAULT_ROLE_CODE = '158965000';
const DEFAULT_ROLE_DISPLAY = 'Doctor';

/**
 * CDR also checks experimental PSGC|2Q-2026 when only Coding.version is set,
 * and that mini CodeSystem rejects valid 1Q-2026 codes. Pin version in system.
 */
function psgcCoding(code, display) {
  return {
    system: PSGC_SYSTEM_VERSIONED || `${PSGC_SYSTEM}|${PSGC_VERSION}`,
    code,
    display: display || code,
  };
}

function escapeNarrative(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** FHIR dom-6: DomainResource should include a narrative. */
function resourceNarrative(divText, lang = 'en') {
  const safe = escapeNarrative(String(divText || '').trim() || 'Resource');
  const langAttr = escapeNarrative(lang || 'en');
  return {
    status: 'generated',
    div: `<div xmlns="http://www.w3.org/1999/xhtml" lang="${langAttr}" xml:lang="${langAttr}"><p>${safe}</p></div>`,
  };
}

function ensureResourceNarrative(resource, fallbackText) {
  if (!resource || typeof resource !== 'object') return resource;
  if (resource.text?.div) return resource;
  const label =
    fallbackText ||
    resource.code?.text ||
    resource.code?.coding?.[0]?.display ||
    resource.name ||
    (Array.isArray(resource.name)
      ? [resource.name[0]?.prefix?.[0], ...(resource.name[0]?.given || []), resource.name[0]?.family]
          .filter(Boolean)
          .join(' ')
      : null) ||
    resource.resourceType ||
    'Resource';
  resource.text = resourceNarrative(label, resource.language || 'en');
  return resource;
}

function buildPatientResource(p) {
  const identifiers = [
    { system: PHILSYS_SYSTEM, value: p.PhilSysId || p.philsysId },
  ];
  const philhealth = p.PhilHealthId || p.philhealthId;
  if (philhealth) {
    identifiers.unshift({ system: PHILHEALTH_SYSTEM, value: philhealth });
  }

  const given = [p.GivenName1 || p.givenName1];
  if (p.GivenName2 || p.givenName2) given.push(p.GivenName2 || p.givenName2);

  const addressExtensions = [];
  const pushExt = (url, code, display) => {
    if (!code) return;
    addressExtensions.push({
      url,
      valueCoding: psgcCoding(code, display),
    });
  };

  pushExt(
    'https://fhir.doh.gov.ph/phcore/StructureDefinition/region',
    p.RegionCode || p.regionCode,
    p.RegionDisplay || p.regionDisplay
  );
  pushExt(
    'https://fhir.doh.gov.ph/phcore/StructureDefinition/province',
    p.ProvinceCode || p.provinceCode,
    p.ProvinceDisplay || p.provinceDisplay
  );
  pushExt(
    'https://fhir.doh.gov.ph/phcore/StructureDefinition/city-municipality',
    p.CityCode || p.cityCode,
    p.CityDisplay || p.cityDisplay
  );
  pushExt(
    'https://fhir.doh.gov.ph/phcore/StructureDefinition/barangay',
    p.BarangayCode || p.barangayCode,
    p.BarangayDisplay || p.barangayDisplay
  );

  const resource = {
    resourceType: 'Patient',
    meta: { profile: [PATIENT_PROFILE] },
    language: 'en',
    identifier: identifiers,
    active: true,
    name: [
      {
        use: 'official',
        family: p.FamilyName || p.familyName,
        given,
      },
    ],
    gender: p.Gender || p.gender,
    birthDate: formatDate(p.BirthDate || p.birthDate),
  };

  const phone = p.Phone || p.phone;
  if (phone) {
    resource.telecom = [{ system: 'phone', value: phone, use: 'mobile' }];
  }

  const line = p.AddressLine || p.addressLine;
  if (line || addressExtensions.length) {
    resource.address = [
      {
        ...(addressExtensions.length ? { extension: addressExtensions } : {}),
        ...(line ? { line: [line] } : {}),
        ...(p.PostalCode || p.postalCode
          ? { postalCode: p.PostalCode || p.postalCode }
          : {}),
        country: 'PH',
      },
    ];
  }

  const nokFamily = p.NextOfKinFamily || p.nextOfKinFamily;
  const nokGiven = p.NextOfKinGiven || p.nextOfKinGiven;
  if (nokFamily || nokGiven) {
    resource.contact = [
      {
        relationship: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v2-0131',
                code: 'N',
                display: 'Next-of-Kin',
              },
            ],
          },
        ],
        name: {
          family: nokFamily || undefined,
          given: nokGiven ? [nokGiven] : undefined,
        },
      },
    ];
  }

  return ensureResourceNarrative(
    resource,
    `${given.join(' ')} ${p.FamilyName || p.familyName || ''}`.trim() || 'Patient'
  );
}

function formatDate(value) {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function parseFhirResponse(res) {
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { resourceType: 'OperationOutcome', issue: [{ diagnostics: text }] };
  }
  if (!res.ok) {
    const issues = Array.isArray(json?.issue) ? json.issue : [];
    const isNoise = (diag) =>
      /Reference to (draft|experimental) (CodeSystem|ValueSet)/i.test(String(diag || ''));
    const preferred =
      issues.find((i) => i.severity === 'error' && i.diagnostics && !isNoise(i.diagnostics))
        ?.diagnostics ||
      issues.find((i) => i.severity === 'fatal' && i.diagnostics)?.diagnostics ||
      issues.find((i) => i.severity === 'error' && i.diagnostics)?.diagnostics ||
      issues.find((i) => i.diagnostics && !isNoise(i.diagnostics))?.diagnostics ||
      issues.find((i) => i.diagnostics)?.diagnostics ||
      json?.issue?.[0]?.details?.text ||
      text ||
      res.statusText;
    const err = new Error(`FHIR request failed (${res.status}): ${preferred}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function isMdmError(err) {
  const msg = String(err?.message || '');
  return (
    Number(err?.status) === 403 &&
    /HAPI-0765|managed by MDM|mdm-record-status|managing-mdm-system/i.test(msg)
  );
}

function isMdmManagedResource(resource) {
  const tags = resource?.meta?.tag || [];
  return tags.some((tag) => {
    const system = String(tag.system || '').toLowerCase();
    const code = String(tag.code || '').toUpperCase();
    if (system.includes('managing-mdm-system') && code === 'HAPI-MDM') return true;
    if (system.includes('mdm-record-status')) {
      return code === 'GOLD' || code === 'GOLDEN' || code === 'GOLDEN_RECORD';
    }
    return false;
  });
}

async function getResourceRaw(resourceType, fhirId) {
  const res = await fetch(`${FHIR_BASE_URL}/${resourceType}/${encodeURIComponent(fhirId)}`, {
    headers: { Accept: 'application/fhir+json' },
  });
  return parseFhirResponse(res);
}

async function queryMdmSourceIds(resourceType, goldenFhirId) {
  try {
    const qs = new URLSearchParams({
      goldenResourceId: `${resourceType}/${goldenFhirId}`,
      matchResult: 'MATCH',
      resourceType,
      _count: '50',
    });
    const res = await fetch(`${FHIR_BASE_URL}/$mdm-query-links?${qs}`, {
      headers: { Accept: 'application/fhir+json' },
    });
    if (!res.ok) return [];
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    const ids = [];
    for (const param of json?.parameter || []) {
      if (param.name !== 'link') continue;
      const sourceRef = (param.part || []).find((p) => p.name === 'sourceResourceId')?.valueString;
      if (!sourceRef) continue;
      const id = String(sourceRef).split('/').pop();
      if (id && id !== String(goldenFhirId)) ids.push(id);
    }
    return ids;
  } catch {
    return [];
  }
}

async function putResourceById(resourceType, fhirId, body) {
  const payload = { ...body, id: String(fhirId) };
  const res = await fetch(`${FHIR_BASE_URL}/${resourceType}/${encodeURIComponent(fhirId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json',
    },
    body: JSON.stringify(payload),
  });
  const json = await parseFhirResponse(res);
  return {
    fhirId: json.id || String(fhirId),
    resource: json,
    status: res.status,
  };
}

async function postResource(resourceType, body) {
  const payload = { ...body };
  delete payload.id;
  const res = await fetch(`${FHIR_BASE_URL}/${resourceType}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json',
    },
    body: JSON.stringify(payload),
  });
  const json = await parseFhirResponse(res);
  return {
    fhirId: json.id,
    resource: json,
    status: res.status,
  };
}

/**
 * Golden MDM records are read-only. Update a linked SOURCE resource when possible,
 * otherwise POST a new source so MDM survivorship can refresh the golden record.
 */
async function updateResourceMdmAware(resourceType, fhirId, body) {
  let existing = null;
  try {
    existing = await getResourceRaw(resourceType, fhirId);
  } catch {
    existing = null;
  }

  if (existing && isMdmManagedResource(existing)) {
    const sourceIds = await queryMdmSourceIds(resourceType, fhirId);
    for (const sourceId of sourceIds) {
      try {
        const result = await putResourceById(resourceType, sourceId, body);
        return {
          ...result,
          fhirId: String(fhirId),
          sourceFhirId: result.fhirId,
          mdm: true,
        };
      } catch (err) {
        if (isMdmError(err)) continue;
        throw err;
      }
    }

    const created = await postResource(resourceType, body);
    return {
      ...created,
      fhirId: String(fhirId),
      sourceFhirId: created.fhirId,
      mdm: true,
    };
  }

  try {
    return await putResourceById(resourceType, fhirId, body);
  } catch (err) {
    if (!isMdmError(err)) throw err;
    const created = await postResource(resourceType, body);
    return {
      ...created,
      fhirId: String(fhirId),
      sourceFhirId: created.fhirId,
      mdm: true,
    };
  }
}

/**
 * Prefer updating a non-MDM source with the same identifier. Avoid conditional PUT
 * against golden MDM records (HAPI-0765).
 */
async function upsertResourceByIdentifier(resourceType, identifierSystem, identifierValue, body) {
  const searchUrl = `${FHIR_BASE_URL}/${resourceType}?identifier=${encodeURIComponent(
    identifierSystem
  )}|${encodeURIComponent(identifierValue)}&_count=20`;

  try {
    const searchRes = await fetch(searchUrl, {
      headers: { Accept: 'application/fhir+json' },
    });
    const bundle = await parseFhirResponse(searchRes);
    const resources = (bundle.entry || [])
      .map((e) => e.resource)
      .filter((r) => r && r.resourceType === resourceType);

    const source = resources.find((r) => r.id && !isMdmManagedResource(r));
    if (source?.id) {
      return putResourceById(resourceType, source.id, body);
    }
    if (resources.some((r) => isMdmManagedResource(r))) {
      return postResource(resourceType, body);
    }
  } catch {
    // Fall through to conditional PUT when search is unavailable.
  }

  const url = `${FHIR_BASE_URL}/${resourceType}?identifier=${encodeURIComponent(
    identifierSystem
  )}|${encodeURIComponent(identifierValue)}`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
      },
      body: JSON.stringify(body),
    });
    const json = await parseFhirResponse(res);
    return {
      fhirId: json.id,
      resource: json,
      status: res.status,
    };
  } catch (err) {
    if (!isMdmError(err)) throw err;
    return postResource(resourceType, body);
  }
}

async function putPatient(patientRow) {
  const philsysId = patientRow.PhilSysId || patientRow.philsysId;
  const body = buildPatientResource(patientRow);
  return upsertResourceByIdentifier('Patient', PHILSYS_SYSTEM, philsysId, body);
}

async function getPatient(fhirId) {
  const json = await getResourceRaw('Patient', fhirId);
  return mapFhirPatient(json);
}

async function updatePatientById(fhirId, patientData) {
  const body = buildPatientResource(patientData);
  return updateResourceMdmAware('Patient', fhirId, body);
}

async function checkFhir() {
  const res = await fetch(`${FHIR_BASE_URL}/metadata`, {
    headers: { Accept: 'application/fhir+json' },
  });
  if (!res.ok) throw new Error(`FHIR metadata ${res.status}`);
  return true;
}

function pickIdentifier(identifiers, systems) {
  if (!Array.isArray(identifiers)) return null;
  for (const system of systems) {
    const hit = identifiers.find((id) => id.system === system && id.value);
    if (hit) return hit.value;
  }
  const any = identifiers.find((id) => id.value);
  return any ? any.value : null;
}

function codingFromExt(extensions, url) {
  const ext = (extensions || []).find((e) => e.url === url);
  return ext?.valueCoding || null;
}

function mapFhirPatient(resource) {
  const name = resource.name?.[0] || {};
  const given = name.given || [];
  const address = resource.address?.[0] || {};
  const region = codingFromExt(address.extension, 'https://fhir.doh.gov.ph/phcore/StructureDefinition/region');
  const province = codingFromExt(address.extension, 'https://fhir.doh.gov.ph/phcore/StructureDefinition/province');
  const city = codingFromExt(address.extension, 'https://fhir.doh.gov.ph/phcore/StructureDefinition/city-municipality');
  const barangay = codingFromExt(address.extension, 'https://fhir.doh.gov.ph/phcore/StructureDefinition/barangay');

  return {
    id: null,
    localCode: '-',
    philsysId:
      pickIdentifier(resource.identifier, [
        PHILSYS_SYSTEM,
        'https://fhir.doh.gov.ph/identifier/philsys',
        'http://philsys.gov.ph/fhir/Identifier/philsys-id',
      ]) || '-',
    philhealthId: pickIdentifier(resource.identifier, [
      PHILHEALTH_SYSTEM,
      'https://fhir.doh.gov.ph/identifier/philhealth',
    ]),
    familyName: name.family || '-',
    givenName1: given[0] || '',
    givenName2: given[1] || null,
    gender: resource.gender || null,
    birthDate: resource.birthDate || null,
    phone: resource.telecom?.find((t) => t.system === 'phone')?.value || null,
    addressLine: address.line?.[0] || null,
    regionCode: region?.code || null,
    regionDisplay: region?.display || null,
    provinceCode: province?.code || null,
    provinceDisplay: province?.display || null,
    cityCode: city?.code || null,
    cityDisplay: city?.display || null,
    barangayCode: barangay?.code || null,
    barangayDisplay: barangay?.display || null,
    postalCode: address.postalCode || null,
    nextOfKinFamily: resource.contact?.[0]?.name?.family || null,
    nextOfKinGiven: resource.contact?.[0]?.name?.given?.[0] || null,
    fhirId: resource.id || null,
    syncStatus: 'synced',
    syncError: null,
    syncedAt: resource.meta?.lastUpdated || null,
    createdAt: resource.meta?.lastUpdated || null,
    updatedAt: resource.meta?.lastUpdated || null,
    source: 'fhir',
  };
}

function matchesQuery(patient, q) {
  if (!q) return true;
  const hay = [
    patient.localCode,
    patient.familyName,
    patient.givenName1,
    patient.givenName2,
    patient.philsysId,
    patient.philhealthId,
    patient.fhirId,
    patient.birthDate,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

async function fetchFhirBundlePages(startUrl, { maxPages = 100 } = {}) {
  const entries = [];
  let nextUrl = startUrl;
  let pages = 0;

  while (nextUrl && pages < maxPages) {
    const res = await fetch(nextUrl, {
      headers: { Accept: 'application/fhir+json' },
    });
    const json = await parseFhirResponse(res);
    pages += 1;
    for (const entry of json?.entry || []) {
      if (entry?.resource) entries.push(entry);
    }
    const next = (json?.link || []).find((l) => l.relation === 'next');
    nextUrl = next?.url || null;
  }

  return entries;
}

async function countFhirResources(resourceType) {
  const type = String(resourceType || '').trim();
  if (!type) {
    const err = new Error('resourceType is required');
    err.status = 400;
    throw err;
  }
  const res = await fetch(`${FHIR_BASE_URL}/${type}?_summary=count`, {
    headers: { Accept: 'application/fhir+json' },
  });
  const json = await parseFhirResponse(res);
  const total = Number(json?.total);
  if (!Number.isFinite(total)) {
    throw new Error(`FHIR ${type} count unavailable`);
  }
  return total;
}

async function searchPatients({ count = 200, q, all = true, maxPages = 100 } = {}) {
  const pageSize = Math.min(500, Math.max(1, Number(count) || 200));
  const params = new URLSearchParams({
    _count: String(pageSize),
    _sort: '-_lastUpdated',
  });
  if (q) {
    // Prefer name search; also try identifier when query looks like an ID.
    if (/^[a-zA-Z]/.test(q) && !q.includes('-') && q.length < 40) {
      params.set('name', q);
    } else {
      params.set('identifier', q);
    }
  }

  const startUrl = `${FHIR_BASE_URL}/Patient?${params}`;
  const entries = all
    ? await fetchFhirBundlePages(startUrl, { maxPages })
    : (
        await parseFhirResponse(
          await fetch(startUrl, { headers: { Accept: 'application/fhir+json' } })
        )
      )?.entry || [];

  let patients = entries
    .map((e) => e.resource)
    .filter((r) => r && r.resourceType === 'Patient')
    .map(mapFhirPatient);

  if (q) {
    const filtered = patients.filter((p) => matchesQuery(p, q));
    // If identifier search returned nothing useful, retry with name.
    if (!filtered.length && !params.has('name')) {
      return searchPatients({ count: pageSize, q: null, all, maxPages }).then((allPatients) =>
        allPatients.filter((p) => matchesQuery(p, q))
      );
    }
    patients = filtered;
  }

  return patients;
}

function mapFhirOrganization(resource) {
  const address = resource.address?.[0] || {};
  const region = codingFromExt(address.extension, 'https://fhir.doh.gov.ph/phcore/StructureDefinition/region');
  const province = codingFromExt(address.extension, 'https://fhir.doh.gov.ph/phcore/StructureDefinition/province');
  const city = codingFromExt(address.extension, 'https://fhir.doh.gov.ph/phcore/StructureDefinition/city-municipality');
  const barangay = codingFromExt(address.extension, 'https://fhir.doh.gov.ph/phcore/StructureDefinition/barangay');

  return {
    id: null,
    localCode: '-',
    name: resource.name || '-',
    nhfrCode:
      pickIdentifier(resource.identifier, [NHFR_SYSTEM]) || '-',
    hcpnCode: pickIdentifier(resource.identifier, [HCPN_SYSTEM]),
    phone: resource.telecom?.find((t) => t.system === 'phone')?.value || null,
    addressLine: address.line?.[0] || null,
    regionCode: region?.code || null,
    regionDisplay: region?.display || null,
    provinceCode: province?.code || null,
    provinceDisplay: province?.display || null,
    cityCode: city?.code || null,
    cityDisplay: city?.display || null,
    barangayCode: barangay?.code || null,
    barangayDisplay: barangay?.display || null,
    postalCode: address.postalCode || null,
    fhirId: resource.id || null,
    syncStatus: 'synced',
    syncError: null,
    syncedAt: resource.meta?.lastUpdated || null,
    createdAt: resource.meta?.lastUpdated || null,
    updatedAt: resource.meta?.lastUpdated || null,
    source: 'fhir',
  };
}

function matchesOrgQuery(org, q) {
  if (!q) return true;
  const hay = [
    org.localCode,
    org.name,
    org.nhfrCode,
    org.hcpnCode,
    org.fhirId,
    org.phone,
    org.addressLine,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

function buildOrganizationResource(o) {
  const identifiers = [
    { system: NHFR_SYSTEM, value: o.NhfrCode || o.nhfrCode },
  ];
  const hcpn = o.HcpnCode || o.hcpnCode;
  if (hcpn) {
    identifiers.push({ system: HCPN_SYSTEM, value: hcpn });
  }

  const addressExtensions = [];
  const pushExt = (url, code, display) => {
    if (!code) return;
    addressExtensions.push({
      url,
      valueCoding: psgcCoding(code, display),
    });
  };

  pushExt(
    'https://fhir.doh.gov.ph/phcore/StructureDefinition/region',
    o.RegionCode || o.regionCode,
    o.RegionDisplay || o.regionDisplay
  );
  pushExt(
    'https://fhir.doh.gov.ph/phcore/StructureDefinition/province',
    o.ProvinceCode || o.provinceCode,
    o.ProvinceDisplay || o.provinceDisplay
  );
  pushExt(
    'https://fhir.doh.gov.ph/phcore/StructureDefinition/city-municipality',
    o.CityCode || o.cityCode,
    o.CityDisplay || o.cityDisplay
  );
  pushExt(
    'https://fhir.doh.gov.ph/phcore/StructureDefinition/barangay',
    o.BarangayCode || o.barangayCode,
    o.BarangayDisplay || o.barangayDisplay
  );

  const resource = {
    resourceType: 'Organization',
    meta: { profile: [ORGANIZATION_PROFILE] },
    language: 'en',
    identifier: identifiers,
    name: o.Name || o.name,
  };

  const phone = o.Phone || o.phone;
  if (phone) {
    resource.telecom = [{ system: 'phone', value: phone, use: 'work' }];
  }

  const line = o.AddressLine || o.addressLine;
  if (line || addressExtensions.length) {
    resource.address = [
      {
        use: 'work',
        ...(addressExtensions.length ? { extension: addressExtensions } : {}),
        ...(line ? { line: [line] } : {}),
        ...(o.PostalCode || o.postalCode
          ? { postalCode: o.PostalCode || o.postalCode }
          : {}),
        country: 'PH',
      },
    ];
  }

  return ensureResourceNarrative(resource, o.Name || o.name || 'Organization');
}

async function putOrganization(orgRow) {
  const nhfrCode = orgRow.NhfrCode || orgRow.nhfrCode;
  const body = buildOrganizationResource(orgRow);
  return upsertResourceByIdentifier('Organization', NHFR_SYSTEM, nhfrCode, body);
}

async function getOrganization(fhirId) {
  const json = await getResourceRaw('Organization', fhirId);
  return mapFhirOrganization(json);
}

async function updateOrganizationById(fhirId, orgData) {
  const body = buildOrganizationResource(orgData);
  return updateResourceMdmAware('Organization', fhirId, body);
}

async function searchOrganizations({ count = 200, q, all = true, maxPages = 100 } = {}) {
  const pageSize = Math.min(500, Math.max(1, Number(count) || 200));
  const params = new URLSearchParams({
    _count: String(pageSize),
    _sort: '-_lastUpdated',
  });
  if (q) {
    if (/^\d+$/.test(q) || q.includes('|')) {
      params.set('identifier', q.includes('|') ? q : `${NHFR_SYSTEM}|${q}`);
    } else {
      params.set('name', q);
    }
  }

  const startUrl = `${FHIR_BASE_URL}/Organization?${params}`;
  const entries = all
    ? await fetchFhirBundlePages(startUrl, { maxPages })
    : (
        await parseFhirResponse(
          await fetch(startUrl, { headers: { Accept: 'application/fhir+json' } })
        )
      )?.entry || [];

  let organizations = entries
    .map((e) => e.resource)
    .filter((r) => r && r.resourceType === 'Organization')
    .map(mapFhirOrganization);

  if (q) {
    const filtered = organizations.filter((o) => matchesOrgQuery(o, q));
    if (!filtered.length && !params.has('name')) {
      return searchOrganizations({ count: pageSize, q: null, all, maxPages }).then((allOrgs) =>
        allOrgs.filter((o) => matchesOrgQuery(o, q))
      );
    }
    organizations = filtered;
  }

  return organizations;
}

function mapFhirPractitioner(resource) {
  const name = resource.name?.[0] || {};
  const given = name.given || [];
  const prefix = name.prefix || [];
  return {
    id: null,
    localCode: '-',
    prcId:
      pickIdentifier(resource.identifier, [PRC_SYSTEM, PRC_SYSTEM_DOH, PRC_SYSTEM_ALT]) || '-',
    familyName: name.family || '-',
    givenName: given[0] || '',
    prefix: prefix[0] || null,
    phone: resource.telecom?.find((t) => t.system === 'phone')?.value || null,
    gender: resource.gender || null,
    fhirId: resource.id || null,
    syncStatus: 'synced',
    syncError: null,
    syncedAt: resource.meta?.lastUpdated || null,
    createdAt: resource.meta?.lastUpdated || null,
    updatedAt: resource.meta?.lastUpdated || null,
    source: 'fhir',
  };
}

function matchesPractitionerQuery(prac, q) {
  if (!q) return true;
  const hay = [
    prac.localCode,
    prac.prcId,
    prac.familyName,
    prac.givenName,
    prac.prefix,
    prac.fhirId,
    prac.phone,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

function buildPractitionerResource(p) {
  const given = [p.GivenName || p.givenName].filter(Boolean);
  const prefix = p.Prefix || p.prefix;
  const resource = {
    resourceType: 'Practitioner',
    meta: { profile: [PRACTITIONER_PROFILE] },
    language: 'en',
    identifier: [
      {
        system: PRC_SYSTEM,
        value: p.PrcId || p.prcId,
      },
    ],
    name: [
      {
        use: 'official',
        family: p.FamilyName || p.familyName,
        given: given.length ? given : undefined,
        ...(prefix ? { prefix: [prefix] } : {}),
      },
    ],
  };

  const phone = p.Phone || p.phone;
  if (phone) {
    resource.telecom = [{ system: 'phone', value: phone, use: 'work' }];
  }

  const gender = p.Gender || p.gender;
  if (gender) {
    resource.gender = gender;
  }

  return ensureResourceNarrative(
    resource,
    `${prefix ? `${prefix} ` : ''}${given.join(' ')} ${p.FamilyName || p.familyName || ''}`.trim() ||
      'Practitioner'
  );
}

async function putPractitioner(pracRow) {
  const prcId = pracRow.PrcId || pracRow.prcId;
  const body = buildPractitionerResource(pracRow);
  return upsertResourceByIdentifier('Practitioner', PRC_SYSTEM, prcId, body);
}

async function getPractitioner(fhirId) {
  const json = await getResourceRaw('Practitioner', fhirId);
  return mapFhirPractitioner(json);
}

async function updatePractitionerById(fhirId, pracData) {
  const body = buildPractitionerResource(pracData);
  return updateResourceMdmAware('Practitioner', fhirId, body);
}

async function searchPractitioners({ count = 200, q, all = true, maxPages = 100 } = {}) {
  const pageSize = Math.min(500, Math.max(1, Number(count) || 200));
  const params = new URLSearchParams({
    _count: String(pageSize),
    _sort: '-_lastUpdated',
  });
  if (q) {
    if (/^\d+$/.test(q) || q.includes('|') || /^PRC/i.test(q)) {
      params.set('identifier', q.includes('|') ? q : `${PRC_SYSTEM}|${q}`);
    } else {
      params.set('name', q);
    }
  }

  const startUrl = `${FHIR_BASE_URL}/Practitioner?${params}`;
  const entries = all
    ? await fetchFhirBundlePages(startUrl, { maxPages })
    : (
        await parseFhirResponse(
          await fetch(startUrl, { headers: { Accept: 'application/fhir+json' } })
        )
      )?.entry || [];

  let practitioners = entries
    .map((e) => e.resource)
    .filter((r) => r && r.resourceType === 'Practitioner')
    .map(mapFhirPractitioner);

  if (q) {
    const filtered = practitioners.filter((p) => matchesPractitionerQuery(p, q));
    if (!filtered.length && !params.has('name')) {
      return searchPractitioners({ count: pageSize, q: null, all, maxPages }).then((allPracs) =>
        allPracs.filter((p) => matchesPractitionerQuery(p, q))
      );
    }
    practitioners = filtered;
  }

  return practitioners;
}

function refId(reference) {
  if (!reference) return null;
  const value = typeof reference === 'string' ? reference : reference.reference;
  if (!value) return null;
  const parts = String(value).split('/');
  return parts[parts.length - 1] || null;
}

function mapFhirPractitionerRole(resource, practitionerResource = null) {
  const coding = resource.code?.[0]?.coding?.[0] || {};
  const specialtyCoding = resource.specialty?.[0]?.coding?.[0] || {};
  const prac = practitionerResource ? mapFhirPractitioner(practitionerResource) : null;
  const active =
    typeof resource.active === 'boolean' ? resource.active : resource.active !== false;
  return {
    id: null,
    localCode: '-',
    prcId:
      pickIdentifier(resource.identifier, [PRC_SYSTEM, PRC_SYSTEM_DOH, PRC_SYSTEM_ALT]) ||
      prac?.prcId ||
      '-',
    roleCode: coding.code || specialtyCoding.code || null,
    roleDisplay:
      coding.display ||
      resource.code?.[0]?.text ||
      specialtyCoding.display ||
      resource.specialty?.[0]?.text ||
      null,
    roleSystem: coding.system || specialtyCoding.system || SNOMED_SYSTEM,
    practitionerFhirId: refId(resource.practitioner),
    organizationFhirId: refId(resource.organization),
    organizationName: null,
    active,
    familyName: prac?.familyName || null,
    givenName: prac?.givenName || null,
    prefix: prac?.prefix || null,
    practitionerName: prac
      ? `${prac.prefix ? `${prac.prefix} ` : ''}${prac.givenName || ''} ${prac.familyName || ''}`.trim()
      : null,
    fhirId: resource.id || null,
    syncStatus: 'synced',
    syncError: null,
    syncedAt: resource.meta?.lastUpdated || null,
    createdAt: resource.meta?.lastUpdated || null,
    updatedAt: resource.meta?.lastUpdated || null,
    source: 'fhir',
  };
}

function matchesPractitionerRoleQuery(role, q) {
  if (!q) return true;
  const hay = [
    role.prcId,
    role.roleCode,
    role.roleDisplay,
    role.practitionerFhirId,
    role.organizationFhirId,
    role.organizationName,
    role.fhirId,
    role.practitionerName,
    role.familyName,
    role.givenName,
    role.active === false ? 'inactive' : 'active',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

function buildPractitionerRoleResource(p) {
  const prcId = p.PrcId || p.prcId;
  const roleCode = p.RoleCode || p.roleCode || DEFAULT_ROLE_CODE;
  const roleDisplay = p.RoleDisplay || p.roleDisplay || DEFAULT_ROLE_DISPLAY;
  const roleSystem = p.RoleSystem || p.roleSystem || SNOMED_SYSTEM;
  const practitionerFhirId =
    p.PractitionerFhirId || p.practitionerFhirId || p.FhirId || p.fhirId;
  const organizationFhirId = p.OrganizationFhirId || p.organizationFhirId;
  const active =
    p.Active === undefined && p.active === undefined
      ? true
      : Boolean(p.Active ?? p.active);

  const resource = {
    resourceType: 'PractitionerRole',
    meta: { profile: [PRACTITIONER_ROLE_PROFILE] },
    language: 'en',
    active,
    identifier: prcId
      ? [
          {
            system: PRC_SYSTEM,
            value: prcId,
          },
        ]
      : undefined,
    code: [
      {
        coding: [
          {
            system: roleSystem,
            code: roleCode,
            display: roleDisplay,
          },
        ],
        text: roleDisplay,
      },
    ],
  };

  if (practitionerFhirId) {
    resource.practitioner = { reference: `Practitioner/${practitionerFhirId}` };
  }
  if (organizationFhirId) {
    resource.organization = { reference: `Organization/${organizationFhirId}` };
  }

  return ensureResourceNarrative(resource, roleDisplay || 'PractitionerRole');
}

async function putPractitionerRole(pracRow) {
  const prcId = pracRow.PrcId || pracRow.prcId;
  const url = `${FHIR_BASE_URL}/PractitionerRole?identifier=${encodeURIComponent(PRC_SYSTEM)}|${encodeURIComponent(prcId)}`;
  const body = buildPractitionerRoleResource(pracRow);

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json',
    },
    body: JSON.stringify(body),
  });

  const json = await parseFhirResponse(res);
  return {
    fhirId: json.id,
    resource: json,
    status: res.status,
  };
}

async function getPractitionerRole(fhirId) {
  const res = await fetch(`${FHIR_BASE_URL}/PractitionerRole/${encodeURIComponent(fhirId)}`, {
    headers: { Accept: 'application/fhir+json' },
  });
  const json = await parseFhirResponse(res);
  return mapFhirPractitionerRole(json);
}

async function updatePractitionerRoleById(fhirId, pracData) {
  const body = buildPractitionerRoleResource(pracData);
  body.id = String(fhirId);
  const res = await fetch(`${FHIR_BASE_URL}/PractitionerRole/${encodeURIComponent(fhirId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json',
    },
    body: JSON.stringify(body),
  });
  const json = await parseFhirResponse(res);
  return {
    fhirId: json.id || String(fhirId),
    resource: json,
    status: res.status,
  };
}

async function searchPractitionerRoles({
  count = 200,
  q,
  practitionerFhirId,
  organizationFhirId,
  all = true,
  maxPages = 100,
} = {}) {
  const pageSize = Math.min(500, Math.max(1, Number(count) || 200));
  const params = new URLSearchParams({
    _count: String(pageSize),
    _sort: '-_lastUpdated',
  });
  if (practitionerFhirId) {
    params.set('practitioner', `Practitioner/${practitionerFhirId}`);
  }
  if (organizationFhirId) {
    params.set('organization', `Organization/${organizationFhirId}`);
  }
  if (q && !practitionerFhirId && !organizationFhirId) {
    if (/^\d+$/.test(q) || q.includes('|') || /^PRC/i.test(q)) {
      params.set('identifier', q.includes('|') ? q : `${PRC_SYSTEM}|${q}`);
    } else {
      params.set('_content', q);
    }
  }

  const startUrl = `${FHIR_BASE_URL}/PractitionerRole?${params}`;
  const entries = all
    ? await fetchFhirBundlePages(startUrl, { maxPages })
    : (
        await parseFhirResponse(
          await fetch(startUrl, { headers: { Accept: 'application/fhir+json' } })
        )
      )?.entry || [];

  let roles = entries
    .map((e) => e.resource)
    .filter((r) => r && r.resourceType === 'PractitionerRole')
    .map((roleResource) => mapFhirPractitionerRole(roleResource));

  if (q && !practitionerFhirId) {
    roles = roles.filter((r) => matchesPractitionerRoleQuery(r, q));
  }

  // Best-effort name enrichment (avoids heavy _include timeouts on CDR).
  const uniquePracIds = [
    ...new Set(roles.map((r) => r.practitionerFhirId).filter(Boolean)),
  ].slice(0, Math.min(roles.length, 40));
  if (uniquePracIds.length) {
    const pracMap = new Map();
    await Promise.all(
      uniquePracIds.map(async (id) => {
        try {
          const prac = await getPractitioner(id);
          pracMap.set(String(id), prac);
        } catch {
          // leave unnamed
        }
      })
    );
    roles = roles.map((role) => {
      const prac = role.practitionerFhirId ? pracMap.get(String(role.practitionerFhirId)) : null;
      if (!prac) return role;
      return {
        ...role,
        familyName: prac.familyName || role.familyName,
        givenName: prac.givenName || role.givenName,
        prefix: prac.prefix || role.prefix,
        prcId: role.prcId && role.prcId !== '-' ? role.prcId : prac.prcId || role.prcId,
        practitionerName:
          `${prac.prefix ? `${prac.prefix} ` : ''}${prac.givenName || ''} ${prac.familyName || ''}`.trim() ||
          role.practitionerName,
      };
    });
  }

  const uniqueOrgIds = [
    ...new Set(roles.map((r) => r.organizationFhirId).filter(Boolean)),
  ].slice(0, Math.min(roles.length, 40));
  if (uniqueOrgIds.length) {
    const orgMap = new Map();
    await Promise.all(
      uniqueOrgIds.map(async (id) => {
        try {
          const org = await getOrganization(id);
          orgMap.set(String(id), org);
        } catch {
          // leave unnamed
        }
      })
    );
    roles = roles.map((role) => {
      const org = role.organizationFhirId ? orgMap.get(String(role.organizationFhirId)) : null;
      if (!org) return role;
      return {
        ...role,
        organizationName: org.name || role.organizationName || null,
      };
    });
  }

  return roles;
}

function attachRolesToPractitioners(practitioners, roles) {
  const byPrc = new Map();
  const byPracRef = new Map();
  for (const role of roles) {
    if (role.prcId && role.prcId !== '-') {
      byPrc.set(String(role.prcId).toLowerCase(), role);
    }
    if (role.practitionerFhirId) {
      byPracRef.set(String(role.practitionerFhirId), role);
    }
  }

  return practitioners.map((p) => {
    const role =
      (p.prcId && byPrc.get(String(p.prcId).toLowerCase())) ||
      (p.fhirId && byPracRef.get(String(p.fhirId))) ||
      null;
    if (!role) {
      return {
        ...p,
        roleCode: p.roleCode || null,
        roleDisplay: p.roleDisplay || null,
        roleFhirId: p.roleFhirId || null,
        organizationFhirId: p.organizationFhirId || null,
      };
    }
    return {
      ...p,
      roleCode: role.roleCode,
      roleDisplay: role.roleDisplay,
      roleFhirId: role.fhirId,
      organizationFhirId: role.organizationFhirId,
      role,
    };
  });
}

function uuidRef(label = '') {
  const stamp = Date.now();
  const suffix = label
    ? `${label}-${stamp}-${crypto.randomBytes(3).toString('hex')}`
    : crypto.randomUUID();
  return `urn:uuid:${suffix}`;
}

function refPatient(fhirId) {
  return { reference: `Patient/${fhirId}` };
}

function refResource(type, fhirId) {
  if (!fhirId) return null;
  const id = String(fhirId).replace(new RegExp(`^${type}/`, 'i'), '');
  return { reference: `${type}/${id}` };
}

function numOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function vitalObservationEntry({
  fullUrl,
  patientFhirId,
  loinc,
  loincDisplay,
  value,
  unit,
  unitCode,
}) {
  return {
    fullUrl,
    resource: {
      resourceType: 'Observation',
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'vital-signs',
              display: 'Vital Signs',
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: 'http://loinc.org',
            code: loinc,
            display: loincDisplay,
          },
        ],
      },
      subject: refPatient(patientFhirId),
      valueQuantity: {
        value,
        unit,
        system: 'http://unitsofmeasure.org',
        code: unitCode,
      },
    },
    request: { method: 'POST', url: 'Observation' },
  };
}

function buildReferralBundle({
  patient,
  sendingOrg,
  receivingOrg,
  sendingPrac,
  receivingPrac,
  data = {},
}) {
  const patientFhirId = patient.FhirId || patient.fhirId;
  const sendingOrgFhirId = sendingOrg.FhirId || sendingOrg.fhirId;
  const receivingOrgFhirId = receivingOrg.FhirId || receivingOrg.fhirId;
  const sendingPracFhirId = sendingPrac.FhirId || sendingPrac.fhirId;
  const receivingPracFhirId = receivingPrac.FhirId || receivingPrac.fhirId;
  const sendingRoleFhirId = sendingPrac.RoleFhirId || sendingPrac.roleFhirId || null;
  const receivingRoleFhirId =
    receivingPrac.RoleFhirId || receivingPrac.roleFhirId || null;
  const now = data.dateOfReferral || new Date().toISOString();
  const effective = data.observationsEffectiveDateTime || now;
  const requisition = data.requisitionValue;

  const sendingRoleUrl = sendingRoleFhirId
    ? `PractitionerRole/${sendingRoleFhirId}`
    : uuidRef('sending-role');
  const receivingRoleUrl = receivingRoleFhirId
    ? `PractitionerRole/${receivingRoleFhirId}`
    : uuidRef('receiving-role');
  const encounterUrl = uuidRef('encounter');
  const chiefComplaintUrl = uuidRef('condition-chief');
  const workingImpressionUrl = uuidRef('condition-dx');
  const serviceRequestUrl = uuidRef('servicerequest');
  const taskUrl = uuidRef('task');
  const procedureUrl = uuidRef('procedure');

  const roleCode = data.practitionerRoleCode || sendingPrac.RoleCode || DEFAULT_ROLE_CODE;
  const roleDisplay =
    data.practitionerRoleDisplay || sendingPrac.RoleDisplay || DEFAULT_ROLE_DISPLAY;

  const entries = [];

  // Prefer existing PractitionerRole FHIR ids (team format). Only PUT when missing.
  if (!sendingRoleFhirId) {
    entries.push({
      fullUrl: sendingRoleUrl,
      resource: buildPractitionerRoleResource({
        PrcId: sendingPrac.PrcId || sendingPrac.prcId,
        RoleCode: roleCode,
        RoleDisplay: roleDisplay,
        FhirId: sendingPracFhirId,
        OrganizationFhirId: sendingOrgFhirId,
      }),
      request: {
        method: 'PUT',
        url: `PractitionerRole?identifier=${PRC_SYSTEM}|${
          sendingPrac.PrcId || sendingPrac.prcId
        }`,
      },
    });
  }

  if (!receivingRoleFhirId) {
    entries.push({
      fullUrl: receivingRoleUrl,
      resource: buildPractitionerRoleResource({
        PrcId: receivingPrac.PrcId || receivingPrac.prcId,
        RoleCode:
          data.receivingPractitionerRoleCode ||
          receivingPrac.RoleCode ||
          roleCode,
        RoleDisplay:
          data.receivingPractitionerRoleDisplay ||
          receivingPrac.RoleDisplay ||
          roleDisplay,
        FhirId: receivingPracFhirId,
        OrganizationFhirId: receivingOrgFhirId,
      }),
      request: {
        method: 'PUT',
        url: `PractitionerRole?identifier=${PRC_SYSTEM}|${
          receivingPrac.PrcId || receivingPrac.prcId
        }`,
      },
    });
  }

  entries.push({
    fullUrl: encounterUrl,
    resource: {
      resourceType: 'Encounter',
      meta: { profile: [ENCOUNTER_PROFILE] },
      language: 'en',
      status: data.encounterStatus || 'finished',
      class: {
        system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
        code: data.encounterClassCode || 'AMB',
        display: 'ambulatory',
      },
      subject: refPatient(patientFhirId),
      participant: [
        {
          individual: { reference: sendingRoleUrl },
        },
      ],
    },
    request: { method: 'POST', url: 'Encounter' },
  });

  const chiefText = data.chiefComplaint || data.chiefComplaintText || 'Chief complaint';
  entries.push({
    fullUrl: chiefComplaintUrl,
    resource: {
      resourceType: 'Condition',
      meta: { profile: [CONDITION_PROFILE] },
      language: 'en',
      clinicalStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: 'active',
          },
        ],
      },
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/condition-category',
              code: 'problem-list-item',
              display: 'Problem List Item',
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: data.chiefComplaintCode || '25064002',
            display: data.chiefComplaintDisplay || 'Headache',
          },
        ],
        text: chiefText,
      },
      subject: refPatient(patientFhirId),
      encounter: { reference: encounterUrl },
      recorder: { reference: sendingRoleUrl },
      note: data.clinicalHistory ? [{ text: data.clinicalHistory }] : undefined,
    },
    request: { method: 'POST', url: 'Condition' },
  });

  const impressionText =
    data.workingImpression || data.workingImpressionText || 'Working impression';
  entries.push({
    fullUrl: workingImpressionUrl,
    resource: {
      resourceType: 'Condition',
      meta: { profile: [CONDITION_PROFILE] },
      language: 'en',
      clinicalStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: 'active',
          },
        ],
      },
      verificationStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
            code: 'provisional',
            display: 'Provisional',
          },
        ],
      },
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/condition-category',
              code: 'encounter-diagnosis',
              display: 'Encounter Diagnosis',
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: data.workingImpressionSystem || SNOMED_SYSTEM,
            code: data.workingImpressionCode || '404684003',
            display: data.workingImpressionDisplay || 'Clinical finding',
          },
        ],
        text: impressionText,
      },
      subject: refPatient(patientFhirId),
      encounter: { reference: encounterUrl },
      recorder: { reference: sendingRoleUrl },
    },
    request: { method: 'POST', url: 'Condition' },
  });

  // Disability observation (team format)
  const disabilityCode = String(data.disabilityCode || '').trim();
  const disabilityDisplay = String(data.disabilityDisplay || data.disabilityText || '').trim();
  if (disabilityCode || disabilityDisplay) {
    entries.push({
      fullUrl: uuidRef('obs-disability'),
      resource: {
        resourceType: 'Observation',
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'exam',
                display: 'Exam',
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '8479-3',
              display: 'Disability status',
            },
          ],
        },
        subject: refPatient(patientFhirId),
        valueCodeableConcept: {
          coding: disabilityCode
            ? [
                {
                  system: SNOMED_SYSTEM,
                  code: disabilityCode,
                  display: disabilityDisplay || disabilityCode,
                },
              ]
            : undefined,
          text: disabilityDisplay || disabilityCode,
        },
      },
      request: { method: 'POST', url: 'Observation' },
    });
  }

  const temperature = numOrNull(data.temperature);
  if (temperature != null) {
    entries.push(
      vitalObservationEntry({
        fullUrl: uuidRef('obs-temp'),
        patientFhirId,
        loinc: '8310-5',
        loincDisplay: 'Body temperature',
        value: temperature,
        unit: 'C',
        unitCode: 'Cel',
      })
    );
  }

  const heartRate = numOrNull(data.heartRate);
  if (heartRate != null) {
    entries.push(
      vitalObservationEntry({
        fullUrl: uuidRef('obs-hr'),
        patientFhirId,
        loinc: '8867-4',
        loincDisplay: 'Heart rate',
        value: heartRate,
        unit: '/min',
        unitCode: '/min',
      })
    );
  }

  const respiratoryRate = numOrNull(data.respiratoryRate);
  if (respiratoryRate != null) {
    entries.push(
      vitalObservationEntry({
        fullUrl: uuidRef('obs-rr'),
        patientFhirId,
        loinc: '9279-1',
        loincDisplay: 'Respiratory rate',
        value: respiratoryRate,
        unit: '/min',
        unitCode: '/min',
      })
    );
  }

  const bpSys = numOrNull(data.bpSystolic);
  const bpDia = numOrNull(data.bpDiastolic);
  if (bpSys != null && bpDia != null) {
    entries.push({
      fullUrl: uuidRef('obs-bp'),
      resource: {
        resourceType: 'Observation',
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'vital-signs',
                display: 'Vital Signs',
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '85354-9',
              display: 'Blood pressure panel',
            },
          ],
        },
        subject: refPatient(patientFhirId),
        component: [
          {
            code: {
              coding: [
                {
                  system: 'http://loinc.org',
                  code: '8480-6',
                  display: 'Systolic blood pressure',
                },
              ],
            },
            valueQuantity: {
              value: bpSys,
              unit: 'mmHg',
              system: 'http://unitsofmeasure.org',
              code: 'mm[Hg]',
            },
          },
          {
            code: {
              coding: [
                {
                  system: 'http://loinc.org',
                  code: '8462-4',
                  display: 'Diastolic blood pressure',
                },
              ],
            },
            valueQuantity: {
              value: bpDia,
              unit: 'mmHg',
              system: 'http://unitsofmeasure.org',
              code: 'mm[Hg]',
            },
          },
        ],
      },
      request: { method: 'POST', url: 'Observation' },
    });
  }

  const oxygenSaturation = numOrNull(data.oxygenSaturation);
  if (oxygenSaturation != null) {
    entries.push(
      vitalObservationEntry({
        fullUrl: uuidRef('obs-spo2'),
        patientFhirId,
        loinc: '59408-5',
        loincDisplay: 'Oxygen saturation in Arterial blood by Pulse oximetry',
        value: oxygenSaturation,
        unit: '%',
        unitCode: '%',
      })
    );
  }

  const weight = numOrNull(data.weight);
  if (weight != null) {
    entries.push(
      vitalObservationEntry({
        fullUrl: uuidRef('obs-weight'),
        patientFhirId,
        loinc: '29463-7',
        loincDisplay: 'Body weight',
        value: weight,
        unit: 'kg',
        unitCode: 'kg',
      })
    );
  }

  if (data.treatmentGiven) {
    entries.push({
      fullUrl: procedureUrl,
      resource: {
        resourceType: 'Procedure',
        meta: { profile: [PROCEDURE_PROFILE] },
        language: 'en',
        status: 'completed',
        code: {
          coding: [
            {
              system: SNOMED_SYSTEM,
              code: '416608005',
              display: 'Drug therapy',
            },
          ],
        },
        subject: refPatient(patientFhirId),
        encounter: { reference: encounterUrl },
        performer: [{ actor: { reference: sendingRoleUrl } }],
        note: [{ text: data.treatmentGiven }],
      },
      request: { method: 'POST', url: 'Procedure' },
    });
  }

  if (data.labConclusion) {
    entries.push({
      fullUrl: uuidRef('diagnosticreport'),
      resource: {
        resourceType: 'DiagnosticReport',
        meta: { profile: [DIAGNOSTIC_REPORT_PROFILE] },
        language: 'en',
        status: 'final',
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '11502-2',
              display: 'Laboratory report',
            },
          ],
          text: data.labTitle || 'Laboratory results',
        },
        subject: refPatient(patientFhirId),
        encounter: { reference: encounterUrl },
        effectiveDateTime: effective,
        performer: [{ reference: sendingRoleUrl }],
        conclusion: data.labConclusion,
      },
      request: { method: 'POST', url: 'DiagnosticReport' },
    });
  }

  const categoryCodeRaw = String(data.categoryCode || '').trim();
  const categoryTextRaw = String(data.categoryText || data.categoryDisplay || '').toLowerCase();
  let categoryCode = '73770003';
  let categoryText = 'Emergency';
  if (categoryCodeRaw === '440655000' || categoryTextRaw.includes('outpatient')) {
    categoryCode = '440655000';
    categoryText = 'Outpatient';
  } else if (categoryCodeRaw === '73770003' || categoryTextRaw.includes('emergency')) {
    categoryCode = '73770003';
    categoryText = 'Emergency';
  } else if (data.categoryText) {
    categoryText = data.categoryText;
  }

  const reasonCodeRaw = String(data.reasonCode || '').trim();
  const reasonTextRaw = String(data.reasonText || data.reasonDisplay || '').toLowerCase();
  const reasonAllowed = {
    '71388002': 'Procedure',
    '11429006': 'Consultation',
    '165197003': 'Diagnostics',
    '3457005': 'Others',
  };
  let reasonServiceCode = '71388002';
  if (reasonAllowed[reasonCodeRaw]) {
    reasonServiceCode = reasonCodeRaw;
  } else if (reasonCodeRaw === '108252007') {
    reasonServiceCode = '165197003';
  } else if (reasonTextRaw.includes('consult')) {
    reasonServiceCode = '11429006';
  } else if (reasonTextRaw.includes('diagnostic') || reasonTextRaw.includes('lab')) {
    reasonServiceCode = '165197003';
  } else if (reasonTextRaw.includes('general') || reasonTextRaw.includes('other')) {
    reasonServiceCode = '3457005';
  }
  const reasonNarrative =
    data.reasonText || data.chiefComplaint || reasonAllowed[reasonServiceCode] || impressionText;

  const priorityRaw = String(data.priority || data.priorityCode || 'routine')
    .trim()
    .toLowerCase();
  const priority = ['routine', 'urgent', 'asap', 'stat'].includes(priorityRaw)
    ? priorityRaw
    : 'routine';

  // Team format: reasonCode = chief complaint + diagnosis coding
  const reasonCodeEntries = [
    {
      text: reasonNarrative,
      coding: [
        {
          system: SNOMED_SYSTEM,
          code: '422843007',
          display: 'Chief complaint',
        },
      ],
    },
  ];
  if (data.workingImpressionIcdCode || data.icdCode) {
    reasonCodeEntries.push({
      coding: [
        {
          system: 'http://hl7.org/fhir/sid/icd-10',
          code: data.workingImpressionIcdCode || data.icdCode,
          display:
            data.workingImpressionIcdDisplay || data.icdDisplay || impressionText,
        },
      ],
    });
  } else if (data.workingImpressionCode) {
    reasonCodeEntries.push({
      coding: [
        {
          system: data.workingImpressionSystem || SNOMED_SYSTEM,
          code: data.workingImpressionCode,
          display: data.workingImpressionDisplay || impressionText,
        },
      ],
      text: impressionText,
    });
  }
  reasonCodeEntries.push({
    coding: [
      {
        system: SNOMED_SYSTEM,
        code: reasonServiceCode,
        display: reasonAllowed[reasonServiceCode],
      },
    ],
    text: data.reasonDisplay || reasonAllowed[reasonServiceCode],
  });

  const serviceRequestPerformer = [];
  if (receivingOrgFhirId) {
    serviceRequestPerformer.push(refResource('Organization', receivingOrgFhirId));
  }
  serviceRequestPerformer.push({ reference: receivingRoleUrl });

  const serviceRequestNote =
    data.referralNote ||
    data.note ||
    (data.treatmentGiven ? `Treatment given: ${data.treatmentGiven}` : null) ||
    'Patient requires specialized medical evaluation and follow-up.';

  const serviceRequest = {
    resourceType: 'ServiceRequest',
    meta: { profile: [SERVICE_REQUEST_PROFILE] },
    status: 'active',
    intent: 'order',
    category: [
      {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: categoryCode,
          },
        ],
        text: categoryText,
      },
    ],
    priority,
    code: {
      coding: [
        {
          system: SNOMED_SYSTEM,
          code: '3457005',
          display: 'Patient referral',
        },
      ],
    },
    subject: refPatient(patientFhirId),
    encounter: { reference: encounterUrl },
    occurrenceDateTime: now,
    authoredOn: now,
    requester: { reference: sendingRoleUrl },
    performer: serviceRequestPerformer,
    reasonCode: reasonCodeEntries,
    reasonReference: [{ reference: workingImpressionUrl }],
    note: [{ text: serviceRequestNote }],
  };
  if (data.linkedConditionFhirId) {
    serviceRequest.supportingInfo = [
      { reference: `Condition/${data.linkedConditionFhirId}` },
    ];
  }
  if (requisition) {
    serviceRequest.requisition = {
      system: REQUISITION_SYSTEM,
      value: requisition,
    };
  }

  entries.push({
    fullUrl: serviceRequestUrl,
    resource: serviceRequest,
    request: { method: 'POST', url: 'ServiceRequest' },
  });

  const patientLabel =
    data.patientName ||
    `${patient.GivenName1 || patient.givenName1 || ''} ${
      patient.FamilyName || patient.familyName || ''
    }`.trim() ||
    'patient';

  // Keep Task for connectathon inbound status workflow.
  entries.push({
    fullUrl: taskUrl,
    resource: {
      resourceType: 'Task',
      meta: { profile: [TASK_PROFILE] },
      language: 'en',
      status: 'requested',
      intent: 'order',
      code: {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: '3457005',
            display: 'Patient referral',
          },
        ],
        text: data.taskCodeText || `eReferral for ${patientLabel}`,
      },
      focus: { reference: serviceRequestUrl },
      for: refPatient(patientFhirId),
      authoredOn: now,
      lastModified: now,
      requester: { reference: sendingRoleUrl },
      owner: { reference: receivingRoleUrl },
      note: [
        {
          text:
            data.taskNote ||
            `New referral for ${patientLabel}. Awaiting receiving facility response.`,
        },
      ],
    },
    request: { method: 'POST', url: 'Task' },
  });

  for (const entry of entries) {
    if (!entry?.resource) continue;
    const type = entry.resource.resourceType;
    const fallback =
      type === 'Encounter'
        ? `Encounter for ${patientLabel}`
        : type === 'ServiceRequest'
          ? `ServiceRequest ${requisition || ''} for ${patientLabel}`.trim()
          : type === 'Task'
            ? `eReferral Task for ${patientLabel}`
            : type === 'Condition'
              ? entry.resource.code?.text || 'Condition'
              : type === 'Observation'
                ? entry.resource.code?.coding?.[0]?.display || 'Observation'
                : type === 'Procedure'
                  ? data.treatmentGiven || 'Procedure'
                  : type === 'DiagnosticReport'
                    ? data.labConclusion || 'DiagnosticReport'
                    : type === 'PractitionerRole'
                      ? entry.resource.code?.[0]?.text || 'PractitionerRole'
                      : type;
    ensureResourceNarrative(entry.resource, fallback);
  }

  return {
    resourceType: 'Bundle',
    language: 'en',
    type: 'transaction',
    timestamp: now,
    entry: entries,
  };
}

function extractCreatedId(entry) {
  if (!entry) return null;
  if (entry.resource?.id) return String(entry.resource.id);
  const loc = String(entry.response?.location || entry.fullUrl || '');
  const match = loc.match(
    /(?:^|\/)(ServiceRequest|Task|Encounter|Condition|Observation|Procedure|DiagnosticReport|PractitionerRole)\/([^/?#_]+)/i
  );
  if (match) return match[2];
  return null;
}

function extractCreatedType(entry, fallbackType) {
  const loc = String(entry?.response?.location || entry?.fullUrl || '');
  const match = loc.match(
    /(?:^|\/)(ServiceRequest|Task|Encounter|Condition|Observation|Procedure|DiagnosticReport|PractitionerRole)\//i
  );
  if (match) return match[1];
  if (entry?.resource?.resourceType) return entry.resource.resourceType;
  return fallbackType || null;
}

function mapBundleResponse(bundleResponse, requestBundle) {
  const byType = {};
  const requestEntries = requestBundle?.entry || [];
  (bundleResponse?.entry || []).forEach((entry, index) => {
    const reqType = extractCreatedType(entry, requestEntries[index]?.resource?.resourceType);
    const id = extractCreatedId(entry);
    if (!reqType || !id) return;
    if (!byType[reqType]) byType[reqType] = [];
    byType[reqType].push(id);
  });
  return {
    serviceRequestId: byType.ServiceRequest?.[0] || null,
    taskId: byType.Task?.[0] || null,
    encounterId: byType.Encounter?.[0] || null,
    idsByType: byType,
  };
}

async function submitReferralBundle(bundle) {
  const res = await fetch(FHIR_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json',
    },
    body: JSON.stringify(bundle),
  });
  const json = await parseFhirResponse(res);
  return {
    status: res.status,
    bundle: json,
    mapped: mapBundleResponse(json, bundle),
  };
}

async function fhirGet(pathOrUrl) {
  const url = String(pathOrUrl).startsWith('http')
    ? pathOrUrl
    : `${FHIR_BASE_URL}/${String(pathOrUrl).replace(/^\//, '')}`;
  const res = await fetch(url, { headers: { Accept: 'application/fhir+json' } });
  return parseFhirResponse(res);
}

async function deleteResource(resourceType, fhirId) {
  if (!resourceType || !fhirId) {
    const err = new Error('resourceType and fhirId are required');
    err.status = 400;
    throw err;
  }
  const res = await fetch(
    `${FHIR_BASE_URL}/${resourceType}/${encodeURIComponent(String(fhirId))}`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/fhir+json' },
    }
  );
  if (res.status === 404 || res.status === 410) {
    return { status: res.status, deleted: false, alreadyGone: true };
  }
  await parseFhirResponse(res);
  return { status: res.status, deleted: true, alreadyGone: false };
}

async function getResourceByReference(reference) {
  if (!reference) return null;
  const value = typeof reference === 'string' ? reference : reference.reference;
  if (!value) return null;
  if (value.startsWith('urn:uuid:')) return null;
  try {
    return await fhirGet(value);
  } catch {
    return null;
  }
}

function humanName(resource) {
  const name = resource?.name?.[0] || {};
  const given = name.given || [];
  const prefix = name.prefix?.[0] ? `${name.prefix[0]} ` : '';
  const full = `${prefix}${given.join(' ')} ${name.family || ''}`.replace(/\s+/g, ' ').trim();
  return full || null;
}

function indexFhirBundleEntries(entries) {
  const byRef = new Map();
  for (const entry of entries || []) {
    const resource = entry?.resource;
    if (!resource?.resourceType || !resource.id) continue;
    byRef.set(`${resource.resourceType}/${resource.id}`, resource);
  }
  return byRef;
}

function refDisplay(reference) {
  if (!reference) return null;
  if (typeof reference === 'string') return null;
  const display = String(reference.display || '').trim();
  return display || null;
}

function lookupRef(byRef, reference) {
  if (!reference) return null;
  const value = typeof reference === 'string' ? reference : reference.reference;
  if (!value || value.startsWith('urn:uuid:')) return null;
  return byRef.get(value) || null;
}

async function searchTasks({
  count = 100,
  status = 'requested,accepted,rejected,in-progress,received,on-hold,completed',
  owner,
  patient,
  all = true,
  maxPages = 50,
  includeRelated = false,
} = {}) {
  const pageSize = Math.min(200, Math.max(1, Number(count) || 100));
  const params = new URLSearchParams({
    _count: String(pageSize),
    _sort: '-_lastUpdated',
  });
  params.set('code', `${SNOMED_SYSTEM}|3457005`);
  if (status) params.set('status', status);
  if (owner) params.set('owner', owner);
  if (patient) params.set('patient', patient.startsWith('Patient/') ? patient : `Patient/${patient}`);
  if (includeRelated) {
    [
      'Task:patient',
      'Task:focus',
      'Task:owner',
      'Task:requester',
      'ServiceRequest:requester',
      'ServiceRequest:performer',
    ].forEach((inc) => params.append('_include', inc));
    ['PractitionerRole:organization', 'PractitionerRole:practitioner'].forEach((inc) =>
      params.append('_include:iterate', inc)
    );
  }

  const startUrl = `${FHIR_BASE_URL}/Task?${params}`;
  const entries = all
    ? await fetchFhirBundlePages(startUrl, { maxPages })
    : (
        await parseFhirResponse(
          await fetch(startUrl, { headers: { Accept: 'application/fhir+json' } })
        )
      )?.entry || [];

  const tasks = entries
    .map((e) => e.resource)
    .filter((r) => r && r.resourceType === 'Task');

  if (!includeRelated) return tasks;
  return { tasks, byRef: indexFhirBundleEntries(entries) };
}

/** List-row summary: uses included bundle resources / reference.display, no nested _resources. */
function summarizeIncomingTaskList(task, byRef = new Map()) {
  const patient = lookupRef(byRef, task.for);
  const serviceRequest = lookupRef(byRef, task.focus);
  const ownerRef = lookupRef(byRef, task.owner);
  const requesterRef = lookupRef(byRef, task.requester);

  const ownerIsOrg = ownerRef?.resourceType === 'Organization';
  const requesterIsOrg = requesterRef?.resourceType === 'Organization';
  const ownerRole = ownerIsOrg ? null : ownerRef;
  const requesterRole = requesterIsOrg ? null : requesterRef;

  const srRequester = serviceRequest?.requester || null;
  const srPerformer = Array.isArray(serviceRequest?.performer)
    ? serviceRequest.performer[0]
    : serviceRequest?.performer || null;
  const srRequesterRes = lookupRef(byRef, srRequester);
  const srPerformerRes = lookupRef(byRef, srPerformer);

  const ownerOrg = ownerIsOrg
    ? ownerRef
    : lookupRef(byRef, ownerRole?.organization);
  const requesterOrg = requesterIsOrg
    ? requesterRef
    : lookupRef(byRef, requesterRole?.organization);
  const srRequesterOrg =
    srRequesterRes?.resourceType === 'Organization'
      ? srRequesterRes
      : lookupRef(byRef, srRequesterRes?.organization);
  const srPerformerOrg =
    srPerformerRes?.resourceType === 'Organization'
      ? srPerformerRes
      : lookupRef(byRef, srPerformerRes?.organization);

  const sendingOrg = requesterOrg || srRequesterOrg || null;
  const receivingOrg = ownerOrg || srPerformerOrg || null;
  const category = serviceRequest?.category?.[0];
  const reason = serviceRequest?.reasonCode?.[0];
  const requisition =
    serviceRequest?.requisition?.value ||
    `TASK-${task.id || crypto.randomUUID().slice(0, 8)}`;

  return {
    taskFhirId: task.id || null,
    taskStatus: task.status || 'requested',
    serviceRequestFhirId: serviceRequest?.id || refId(task.focus),
    encounterFhirId: refId(serviceRequest?.encounter),
    patientFhirId: patient?.id || refId(task.for),
    patientName: humanName(patient) || refDisplay(task.for) || 'Unknown patient',
    sendingOrgFhirId:
      sendingOrg?.id ||
      refId(requesterRole?.organization) ||
      refId(srRequester) ||
      null,
    sendingOrgName:
      sendingOrg?.name ||
      refDisplay(requesterRole?.organization) ||
      refDisplay(task.requester) ||
      refDisplay(srRequester) ||
      null,
    receivingOrgFhirId:
      receivingOrg?.id ||
      refId(ownerRole?.organization) ||
      refId(srPerformer) ||
      null,
    receivingOrgName:
      receivingOrg?.name ||
      refDisplay(ownerRole?.organization) ||
      refDisplay(task.owner) ||
      refDisplay(srPerformer) ||
      null,
    sendingPracFhirId:
      refId(requesterRole?.practitioner) ||
      (srRequesterRes?.resourceType === 'Practitioner' ? srRequesterRes.id : null),
    sendingPracName:
      humanName(lookupRef(byRef, requesterRole?.practitioner)) ||
      humanName(srRequesterRes?.resourceType === 'Practitioner' ? srRequesterRes : null),
    receivingPracFhirId:
      refId(ownerRole?.practitioner) ||
      (srPerformerRes?.resourceType === 'Practitioner' ? srPerformerRes.id : null),
    receivingPracName:
      humanName(lookupRef(byRef, ownerRole?.practitioner)) ||
      humanName(srPerformerRes?.resourceType === 'Practitioner' ? srPerformerRes : null),
    categoryCode: category?.coding?.[0]?.code || null,
    categoryDisplay: category?.coding?.[0]?.display || null,
    categoryText: category?.text || category?.coding?.[0]?.display || null,
    reasonCode: reason?.coding?.[0]?.code || null,
    reasonDisplay: reason?.coding?.[0]?.display || null,
    reasonText: reason?.text || reason?.coding?.[0]?.display || null,
    referralNote: serviceRequest?.note?.[0]?.text || null,
    taskNote: task.note?.[0]?.text || null,
    requisitionValue: requisition,
    dateOfReferral: serviceRequest?.authoredOn || task.authoredOn || task.meta?.lastUpdated || null,
    createdAt: task.meta?.lastUpdated || null,
    ownerRoleFhirId: ownerRole?.id || (ownerIsOrg ? null : refId(task.owner)),
    requesterRoleFhirId: requesterRole?.id || (requesterIsOrg ? null : refId(task.requester)),
  };
}

async function getTask(fhirId) {
  return fhirGet(`Task/${encodeURIComponent(fhirId)}`);
}

async function getServiceRequest(fhirId) {
  return fhirGet(`ServiceRequest/${encodeURIComponent(fhirId)}`);
}

async function updateTaskStatus(fhirId, status, noteText) {
  const task = await getTask(fhirId);
  task.status = status;
  task.lastModified = new Date().toISOString();
  if (noteText) {
    task.note = [...(task.note || []), { text: noteText, time: task.lastModified }];
  }
  const res = await fetch(`${FHIR_BASE_URL}/Task/${encodeURIComponent(fhirId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json',
    },
    body: JSON.stringify(task),
  });
  const json = await parseFhirResponse(res);
  return { fhirId: json.id || String(fhirId), resource: json, status: res.status };
}

async function putFhirResource(resource) {
  if (!resource?.resourceType || !resource?.id) {
    const err = new Error('FHIR resource type and id are required for update.');
    err.status = 400;
    throw err;
  }
  const res = await fetch(
    `${FHIR_BASE_URL}/${resource.resourceType}/${encodeURIComponent(resource.id)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/fhir+json',
        Accept: 'application/fhir+json',
      },
      body: JSON.stringify(resource),
    }
  );
  const json = await parseFhirResponse(res);
  return { fhirId: json.id || String(resource.id), resource: json, status: res.status };
}

/**
 * Re-route an incoming referral Task to a new receiving PractitionerRole (+ ServiceRequest.performer).
 * Keeps Task.status as requested so the new facility can accept it.
 */
async function transferIncomingReferral({
  taskFhirId,
  receivingOrgFhirId,
  receivingPracRoleFhirId,
  reason,
  receivingOrgName,
  receivingPracName,
} = {}) {
  const taskId = String(taskFhirId || '').trim();
  const roleId = String(receivingPracRoleFhirId || '').trim();
  const orgId = String(receivingOrgFhirId || '').trim();
  const noteText = String(reason || '').trim();

  if (!taskId) {
    const err = new Error('Task FHIR ID is required.');
    err.status = 400;
    throw err;
  }
  if (!roleId) {
    const err = new Error('New receiving practitioner role is required.');
    err.status = 400;
    throw err;
  }
  if (!orgId) {
    const err = new Error('New receiving facility is required.');
    err.status = 400;
    throw err;
  }
  if (!noteText) {
    const err = new Error('Transfer reason is required.');
    err.status = 400;
    throw err;
  }

  const [task, role] = await Promise.all([
    getTask(taskId),
    getPractitionerRole(roleId),
  ]);

  const roleOrgId = String(role?.organizationFhirId || refId(role?.organization) || '').trim();
  if (roleOrgId && roleOrgId !== orgId) {
    const err = new Error(
      'Selected practitioner role does not belong to the selected receiving facility.'
    );
    err.status = 400;
    throw err;
  }

  const roleRef = `PractitionerRole/${roleId}`;
  const orgRef = `Organization/${orgId}`;
  const now = new Date().toISOString();
  const pracLabel =
    receivingPracName ||
    role?.practitionerName ||
    [
      role?.prefix ? `${role.prefix} ` : '',
      role?.givenName || '',
      role?.familyName || '',
    ]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim() ||
    roleId;
  const orgMapped = await getOrganization(orgId).catch(() => null);
  const orgLabel = receivingOrgName || orgMapped?.name || orgId;
  const transferNote = `Transferred to ${orgLabel} (${pracLabel}): ${noteText}`;

  const previousOwner = task.owner?.reference || null;
  task.owner = {
    reference: roleRef,
    display: pracLabel,
  };
  task.lastModified = now;
  // Keep open so the new receiving facility can accept.
  if (!['requested', 'received', 'in-progress', 'on-hold'].includes(String(task.status || ''))) {
    task.status = 'requested';
  }
  task.note = [...(task.note || []), { text: transferNote, time: now }];

  const taskResult = await putFhirResource(task);

  let serviceRequestResult = null;
  const srId = refId(task.focus);
  if (srId) {
    try {
      const serviceRequest = await getServiceRequest(srId);
      serviceRequest.performer = [
        {
          reference: roleRef,
          display: pracLabel,
        },
      ];
      // Also stamp facility on note for audit trail.
      serviceRequest.note = [
        ...(serviceRequest.note || []),
        { text: transferNote, time: now },
      ];
      serviceRequestResult = await putFhirResource(serviceRequest);
    } catch (err) {
      // Task owner already moved; surface SR failure as warning payload.
      serviceRequestResult = {
        error: err.message || 'Could not update ServiceRequest performer',
        organizationReference: orgRef,
      };
    }
  }

  return {
    taskFhirId: taskId,
    taskStatus: task.status || 'requested',
    receivingOrgFhirId: orgId,
    receivingOrgName: orgLabel,
    receivingPracRoleFhirId: roleId,
    receivingPracName: pracLabel,
    previousOwner,
    transferNote,
    task: taskResult,
    serviceRequest: serviceRequestResult,
  };
}

async function enrichIncomingTask(task) {
  const [patient, serviceRequest, ownerRef, requesterRef] = await Promise.all([
    getResourceByReference(task.for),
    getResourceByReference(task.focus),
    getResourceByReference(task.owner),
    getResourceByReference(task.requester),
  ]);

  const ownerIsOrg = ownerRef?.resourceType === 'Organization';
  const requesterIsOrg = requesterRef?.resourceType === 'Organization';
  const ownerRole = ownerIsOrg ? null : ownerRef;
  const requesterRole = requesterIsOrg ? null : requesterRef;

  const srRequester = serviceRequest?.requester || null;
  const srPerformer = Array.isArray(serviceRequest?.performer)
    ? serviceRequest.performer[0]
    : serviceRequest?.performer || null;

  const [ownerOrg, requesterOrg, ownerPrac, requesterPrac, srRequesterRes, srPerformerRes] =
    await Promise.all([
      ownerIsOrg ? Promise.resolve(ownerRef) : getResourceByReference(ownerRole?.organization),
      requesterIsOrg
        ? Promise.resolve(requesterRef)
        : getResourceByReference(requesterRole?.organization),
      getResourceByReference(ownerRole?.practitioner),
      getResourceByReference(requesterRole?.practitioner),
      getResourceByReference(srRequester),
      getResourceByReference(srPerformer),
    ]);

  const [srRequesterOrg, srPerformerOrg] = await Promise.all([
    srRequesterRes?.resourceType === 'Organization'
      ? Promise.resolve(srRequesterRes)
      : getResourceByReference(srRequesterRes?.organization),
    srPerformerRes?.resourceType === 'Organization'
      ? Promise.resolve(srPerformerRes)
      : getResourceByReference(srPerformerRes?.organization),
  ]);

  const category = serviceRequest?.category?.[0];
  const reason = serviceRequest?.reasonCode?.[0];
  const requisition =
    serviceRequest?.requisition?.value ||
    `TASK-${task.id || crypto.randomUUID().slice(0, 8)}`;

  const sendingOrg = requesterOrg || srRequesterOrg || null;
  const receivingOrg = ownerOrg || srPerformerOrg || null;

  return {
    taskFhirId: task.id || null,
    taskStatus: task.status || 'requested',
    serviceRequestFhirId: serviceRequest?.id || refId(task.focus),
    encounterFhirId: refId(serviceRequest?.encounter),
    patientFhirId: patient?.id || refId(task.for),
    patientName: humanName(patient) || 'Unknown patient',
    sendingOrgFhirId: sendingOrg?.id || refId(requesterRole?.organization) || null,
    sendingOrgName: sendingOrg?.name || null,
    receivingOrgFhirId: receivingOrg?.id || refId(ownerRole?.organization) || null,
    receivingOrgName: receivingOrg?.name || null,
    sendingPracFhirId: requesterPrac?.id || refId(requesterRole?.practitioner),
    sendingPracName: humanName(requesterPrac),
    receivingPracFhirId: ownerPrac?.id || refId(ownerRole?.practitioner),
    receivingPracName: humanName(ownerPrac),
    categoryCode: category?.coding?.[0]?.code || null,
    categoryDisplay: category?.coding?.[0]?.display || null,
    categoryText: category?.text || category?.coding?.[0]?.display || null,
    reasonCode: reason?.coding?.[0]?.code || null,
    reasonDisplay: reason?.coding?.[0]?.display || null,
    reasonText: reason?.text || reason?.coding?.[0]?.display || null,
    referralNote: serviceRequest?.note?.[0]?.text || null,
    taskNote: task.note?.[0]?.text || null,
    requisitionValue: requisition,
    dateOfReferral: serviceRequest?.authoredOn || task.authoredOn || task.meta?.lastUpdated || null,
    createdAt: task.meta?.lastUpdated || null,
    ownerRoleFhirId: ownerRole?.id || (ownerIsOrg ? null : refId(task.owner)),
    requesterRoleFhirId: requesterRole?.id || (requesterIsOrg ? null : refId(task.requester)),
    _resources: {
      task,
      serviceRequest,
      patient,
      ownerRole,
      requesterRole,
      ownerOrg: receivingOrg,
      requesterOrg: sendingOrg,
      ownerPrac,
      requesterPrac,
    },
  };
}

async function searchTypedResources(resourceType, { patientFhirId, encounterFhirId, count = 30 } = {}) {
  const params = new URLSearchParams({
    _count: String(count),
    _sort: '-_lastUpdated',
  });
  if (patientFhirId) params.set('patient', `Patient/${patientFhirId}`);
  if (encounterFhirId) params.set('encounter', `Encounter/${encounterFhirId}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${FHIR_BASE_URL}/${resourceType}?${params}`, {
      headers: { Accept: 'application/fhir+json' },
      signal: controller.signal,
    });
    const json = await parseFhirResponse(res);
    return (json?.entry || [])
      .map((e) => e.resource)
      .filter((r) => r && r.resourceType === resourceType);
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`FHIR ${resourceType} search timed out`);
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    const wrapped = new Error(err.cause?.message || err.message || `FHIR ${resourceType} search failed`);
    wrapped.status = err.status || 502;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

function summarizeCondition(resource) {
  if (!resource) return null;
  const coding = resource.code?.coding?.[0] || {};
  return {
    id: resource.id || null,
    category: resource.category?.[0]?.coding?.[0]?.code || resource.category?.[0]?.text || null,
    code: coding.code || null,
    display: coding.display || null,
    text: resource.code?.text || coding.display || null,
    clinicalStatus: resource.clinicalStatus?.coding?.[0]?.code || null,
    note: resource.note?.[0]?.text || null,
  };
}

function summarizeObservation(resource) {
  if (!resource) return null;
  const coding = resource.code?.coding?.[0] || {};
  let value = null;
  if (resource.valueQuantity) {
    value = `${resource.valueQuantity.value ?? ''} ${resource.valueQuantity.unit || resource.valueQuantity.code || ''}`.trim();
  } else if (resource.valueString) {
    value = resource.valueString;
  } else if (resource.component?.length) {
    value = resource.component
      .map((c) => {
        const label = c.code?.coding?.[0]?.display || c.code?.text || 'component';
        const q = c.valueQuantity;
        return q ? `${label}: ${q.value ?? ''} ${q.unit || ''}`.trim() : label;
      })
      .join('; ');
  }
  return {
    id: resource.id || null,
    code: coding.code || null,
    display: coding.display || resource.code?.text || null,
    effectiveDateTime: resource.effectiveDateTime || null,
    value,
    status: resource.status || null,
  };
}

function summarizeProcedure(resource) {
  if (!resource) return null;
  const coding = resource.code?.coding?.[0] || {};
  return {
    id: resource.id || null,
    code: coding.code || null,
    display: coding.display || resource.code?.text || null,
    status: resource.status || null,
    note: resource.note?.[0]?.text || null,
  };
}

function summarizeDiagnosticReport(resource) {
  if (!resource) return null;
  const coding = resource.code?.coding?.[0] || {};
  return {
    id: resource.id || null,
    code: coding.code || null,
    display: coding.display || resource.code?.text || null,
    status: resource.status || null,
    conclusion: resource.conclusion || null,
    title: resource.presentedForm?.[0]?.title || null,
  };
}

async function loadIncomingReferralPackage(taskOrId) {
  const task =
    typeof taskOrId === 'string' || typeof taskOrId === 'number'
      ? await getTask(String(taskOrId))
      : taskOrId;
  if (!task || task.resourceType !== 'Task') {
    throw Object.assign(new Error('Task not found'), { status: 404 });
  }

  const summary = await enrichIncomingTask(task);
  const resources = summary._resources || {};
  delete summary._resources;

  const patientFhirId = summary.patientFhirId;
  const encounterFhirId = summary.encounterFhirId;

  let encounter = null;
  if (encounterFhirId) {
    try {
      encounter = await fhirGet(`Encounter/${encodeURIComponent(encounterFhirId)}`);
    } catch {
      encounter = null;
    }
  }

  const reasonRefs = resources.serviceRequest?.reasonReference || [];
  const reasonConditions = (
    await Promise.all(reasonRefs.map((ref) => getResourceByReference(ref)))
  ).filter(Boolean);

  const [conditions, observations, procedures, diagnosticReports] = await Promise.all([
    patientFhirId
      ? searchTypedResources('Condition', { patientFhirId, encounterFhirId }).catch(() => [])
      : Promise.resolve([]),
    patientFhirId
      ? searchTypedResources('Observation', { patientFhirId, encounterFhirId }).catch(() => [])
      : Promise.resolve([]),
    patientFhirId
      ? searchTypedResources('Procedure', { patientFhirId, encounterFhirId }).catch(() => [])
      : Promise.resolve([]),
    patientFhirId
      ? searchTypedResources('DiagnosticReport', { patientFhirId, encounterFhirId }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const conditionMap = new Map();
  [...reasonConditions, ...conditions].forEach((c) => {
    if (c?.id) conditionMap.set(c.id, c);
  });

  const clinical = {
    conditions: [...conditionMap.values()].map(summarizeCondition).filter(Boolean),
    observations: observations.map(summarizeObservation).filter(Boolean),
    procedures: procedures.map(summarizeProcedure).filter(Boolean),
    diagnosticReports: diagnosticReports.map(summarizeDiagnosticReport).filter(Boolean),
  };

  const chief =
    clinical.conditions.find((c) => String(c.category || '').includes('problem')) ||
    clinical.conditions[0] ||
    null;
  const impression =
    clinical.conditions.find((c) => String(c.category || '').includes('encounter')) ||
    clinical.conditions[1] ||
    null;

  if (chief?.text) summary.chiefComplaint = summary.chiefComplaint || chief.text;
  if (impression?.text) summary.workingImpression = summary.workingImpression || impression.text;
  if (clinical.procedures[0]?.note) {
    summary.treatmentGiven = summary.treatmentGiven || clinical.procedures[0].note;
  }
  if (clinical.diagnosticReports[0]?.conclusion) {
    summary.labConclusion = summary.labConclusion || clinical.diagnosticReports[0].conclusion;
  }

  return {
    summary,
    clinical,
    resources: {
      task: resources.task || task,
      serviceRequest: resources.serviceRequest || null,
      patient: resources.patient || null,
      encounter,
      sendingPractitionerRole: resources.requesterRole || null,
      receivingPractitionerRole: resources.ownerRole || null,
      sendingOrganization: resources.requesterOrg || null,
      receivingOrganization: resources.ownerOrg || null,
      sendingPractitioner: resources.requesterPrac || null,
      receivingPractitioner: resources.ownerPrac || null,
      conditions: [...conditionMap.values()],
      observations,
      procedures,
      diagnosticReports,
    },
  };
}

/** Package related referral resources as a Bundle.type=collection (export / handoff). */
function buildReferralCollectionBundle(packageData) {
  const resources = packageData?.resources || {};
  const summary = packageData?.summary || {};
  const entries = [];
  const seen = new Set();

  const pushResource = (resource) => {
    if (!resource?.resourceType) return;
    const key = resource.id ? `${resource.resourceType}/${resource.id}` : null;
    if (key) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    const entry = { resource };
    if (key) entry.fullUrl = `${FHIR_BASE_URL}/${key}`;
    entries.push(entry);
  };

  [
    resources.task,
    resources.serviceRequest,
    resources.patient,
    resources.encounter,
    resources.sendingPractitionerRole,
    resources.receivingPractitionerRole,
    resources.sendingOrganization,
    resources.receivingOrganization,
    resources.sendingPractitioner,
    resources.receivingPractitioner,
  ].forEach(pushResource);

  (resources.conditions || []).forEach(pushResource);
  (resources.observations || []).forEach(pushResource);
  (resources.procedures || []).forEach(pushResource);
  (resources.diagnosticReports || []).forEach(pushResource);

  const taskId = summary.taskFhirId || resources.task?.id || 'unknown';
  return {
    resourceType: 'Bundle',
    id: `eref-collection-${taskId}`,
    language: 'en',
    type: 'collection',
    timestamp: new Date().toISOString(),
    identifier: {
      system: 'https://fhir.doh.gov.ph/pheref/Identifier/referral-collection',
      value: String(taskId),
    },
    entry: entries,
  };
}

async function loadReferralCollectionBundle(taskOrId) {
  const packageData = await loadIncomingReferralPackage(taskOrId);
  return {
    package: packageData,
    bundle: buildReferralCollectionBundle(packageData),
  };
}

function summarizeHistoryEntry(entry) {
  const resource = entry?.resource || {};
  const notes = Array.isArray(resource.note) ? resource.note : [];
  const latestNote = notes.length ? notes[notes.length - 1] : null;
  const business =
    resource.businessStatus?.text ||
    resource.businessStatus?.coding?.[0]?.display ||
    resource.businessStatus?.coding?.[0]?.code ||
    null;
  const method = entry?.request?.method || null;
  const responseStatus = entry?.response?.status || null;
  const statusCode = String(responseStatus || '').match(/^(\d{3})/)?.[1] || null;

  let action = null;
  if (method === 'DELETE' || statusCode === '404' || statusCode === '410') action = 'Deleted';
  else if (method === 'POST' || statusCode === '201') action = 'Created';
  else if (method === 'PUT' || method === 'PATCH' || statusCode === '200') action = 'Updated';

  const summary = {
    resourceType: resource.resourceType || null,
    id: resource.id || null,
    versionId: resource.meta?.versionId || null,
    lastUpdated: resource.meta?.lastUpdated || latestNote?.time || entry?.response?.lastModified || null,
    status: resource.status || null,
    businessStatus: business,
    note: latestNote?.text || null,
    method,
    responseStatus,
    action,
  };

  if (resource.resourceType === 'Patient') {
    const name = resource.name?.[0] || {};
    const given = name.given || [];
    summary.displayName =
      [...given, name.family].filter(Boolean).join(' ').trim() || null;
    summary.gender = resource.gender || null;
    summary.birthDate = resource.birthDate || null;
    summary.phone = resource.telecom?.find((t) => t.system === 'phone')?.value || null;
    summary.addressLine = resource.address?.[0]?.line?.[0] || null;
    summary.philsysId =
      pickIdentifier(resource.identifier, [
        PHILSYS_SYSTEM,
        'https://fhir.doh.gov.ph/identifier/philsys',
        'http://philsys.gov.ph/fhir/Identifier/philsys-id',
      ]) || null;
    summary.philhealthId =
      pickIdentifier(resource.identifier, [
        PHILHEALTH_SYSTEM,
        'https://fhir.doh.gov.ph/identifier/philhealth',
      ]) || null;
    summary.active = resource.active;
  }

  return summary;
}

function patientHistorySnapshot(row) {
  return {
    Name: row.displayName || '-',
    Gender: row.gender || '-',
    'Birth Date': row.birthDate || '-',
    Phone: row.phone || '-',
    Address: row.addressLine || '-',
    PhilSys: row.philsysId || '-',
    PhilHealth: row.philhealthId || '-',
  };
}

function diffPatientHistoryRows(older, newer) {
  const a = patientHistorySnapshot(older || {});
  const b = patientHistorySnapshot(newer || {});
  const changes = [];
  for (const key of Object.keys(b)) {
    if (String(a[key] ?? '-') === String(b[key] ?? '-')) continue;
    changes.push({
      field: key,
      from: a[key],
      to: b[key],
    });
  }
  return changes;
}

function enrichPatientHistoryTimeline(timeline) {
  // Newest first: compare each version with the next older one.
  for (let i = 0; i < timeline.length; i += 1) {
    const current = timeline[i];
    const older = timeline[i + 1] || null;
    if (!older) {
      current.action = current.action || 'Created';
      current.changes = [];
      continue;
    }
    current.action = current.action || 'Updated';
    current.changes = diffPatientHistoryRows(older, current);
  }
  return timeline;
}

/** Fetch FHIR _history Bundle and a newest-first timeline summary. */
async function fetchResourceHistory(resourceType, fhirId, { count = 50 } = {}) {
  if (!resourceType || !fhirId) {
    const err = new Error('resourceType and fhirId are required');
    err.status = 400;
    throw err;
  }
  const safeCount = Math.min(100, Math.max(1, Number(count) || 50));
  const path = `${resourceType}/${encodeURIComponent(String(fhirId))}/_history?_count=${safeCount}`;
  const bundle = await fhirGet(path);
  if (bundle?.resourceType !== 'Bundle') {
    const err = new Error(`Unexpected history response for ${resourceType}/${fhirId}`);
    err.status = 502;
    throw err;
  }

  let timeline = (bundle.entry || [])
    .map(summarizeHistoryEntry)
    .filter((row) => row.resourceType)
    .sort((a, b) => {
      const tb = Date.parse(b.lastUpdated || '') || 0;
      const ta = Date.parse(a.lastUpdated || '') || 0;
      if (tb !== ta) return tb - ta;
      return String(b.versionId || '').localeCompare(String(a.versionId || ''), undefined, {
        numeric: true,
      });
    });

  if (resourceType === 'Patient') {
    timeline = enrichPatientHistoryTimeline(timeline);
  }

  return {
    resourceType,
    fhirId: String(fhirId),
    bundle: {
      ...bundle,
      type: bundle.type || 'history',
    },
    timeline,
    total: timeline.length,
  };
}

async function fetchPatientHistory(patientFhirId, options = {}) {
  return fetchResourceHistory('Patient', patientFhirId, options);
}

async function fetchTaskHistory(taskFhirId, options = {}) {
  return fetchResourceHistory('Task', taskFhirId, options);
}

module.exports = {
  FHIR_BASE_URL,
  PHILSYS_SYSTEM,
  PHILHEALTH_SYSTEM,
  NHFR_SYSTEM,
  HCPN_SYSTEM,
  PRC_SYSTEM,
  REQUISITION_SYSTEM,
  DEFAULT_ROLE_CODE,
  DEFAULT_ROLE_DISPLAY,
  putPatient,
  updatePatientById,
  getPatient,
  checkFhir,
  searchPatients,
  matchesQuery,
  buildPatientResource,
  countFhirResources,
  putOrganization,
  updateOrganizationById,
  getOrganization,
  searchOrganizations,
  mapFhirOrganization,
  buildOrganizationResource,
  putPractitioner,
  updatePractitionerById,
  getPractitioner,
  searchPractitioners,
  mapFhirPractitioner,
  buildPractitionerResource,
  putPractitionerRole,
  updatePractitionerRoleById,
  getPractitionerRole,
  searchPractitionerRoles,
  mapFhirPractitionerRole,
  buildPractitionerRoleResource,
  attachRolesToPractitioners,
  buildReferralBundle,
  submitReferralBundle,
  searchTasks,
  getTask,
  getServiceRequest,
  updateTaskStatus,
  transferIncomingReferral,
  enrichIncomingTask,
  summarizeIncomingTaskList,
  loadIncomingReferralPackage,
  buildReferralCollectionBundle,
  loadReferralCollectionBundle,
  fetchResourceHistory,
  fetchPatientHistory,
  fetchTaskHistory,
  searchTypedResources,
  summarizeCondition,
  getResourceByReference,
  refId,
  deleteResource,
};
