require('dotenv').config();

/*
 * Pure FHIR-only mode: local database setup has been removed.
 * FHIR Server is the sole source of truth.
 */
const USE_PERSISTENT_LOCAL_DB = false;
const dbPath = ':memory:';
const TEAM_PREFIX = process.env.TEAM_PREFIX || 'TEAM07';

function getDefaultFacilityConfig() {
  const fhirId = String(process.env.DEFAULT_FACILITY_FHIR_ID || '').trim();
  if (!fhirId) return null;
  return {
    fhirId,
    name:
      String(process.env.DEFAULT_FACILITY_NAME || '').trim() ||
      'Default Facility',
    nhfrCode: String(process.env.DEFAULT_FACILITY_NHFR || '').trim() || fhirId,
    hcpnCode: String(process.env.DEFAULT_FACILITY_HCPN || '').trim() || null,
    phone: String(process.env.DEFAULT_FACILITY_PHONE || '').trim() || null,
    addressLine: String(process.env.DEFAULT_FACILITY_ADDRESS || '').trim() || null,
  };
}

function ensureDefaultFacility() {
  const cfg = getDefaultFacilityConfig();
  if (!cfg) return null;
  return {
    id: 1,
    localCode: `${TEAM_PREFIX}-O0001`,
    name: cfg.name,
    nhfrCode: cfg.nhfrCode,
    hcpnCode: cfg.hcpnCode,
    phone: cfg.phone,
    addressLine: cfg.addressLine,
    fhirId: cfg.fhirId,
    syncStatus: 'synced',
    source: 'fhir',
  };
}

const defaultFacilityRow = ensureDefaultFacility();

// Safe fallback interface so routes calling db methods operate gracefully without local SQLite
const createMockStmt = () => ({
  get: () => null,
  all: () => [],
  run: () => ({ lastInsertRowid: 1, changes: 0 }),
});

const db = {
  prepare: () => createMockStmt(),
  exec: () => {},
  pragma: () => {},
  transaction: (fn) => fn,
};

function checkDb() {
  return { status: 'disabled', message: 'Local DB disabled; app uses FHIR live server.' };
}

module.exports = {
  db,
  checkDb,
  dbPath,
  USE_PERSISTENT_LOCAL_DB,
  TEAM_PREFIX,
  getDefaultFacilityConfig,
  ensureDefaultFacility,
  defaultFacilityRow,
};
