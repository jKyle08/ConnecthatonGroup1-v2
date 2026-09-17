require('dotenv').config();

/*
 * Pure FHIR-only mode: local database setup has been removed.
 * FHIR Server is the sole source of truth.
 * In-memory store keeps lightweight scratch records so routes function seamlessly.
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

const tables = {
  Patients: new Map(),
  Organizations: new Map(),
  Practitioners: new Map(),
  PractitionerRoles: new Map(),
  Referrals: new Map(),
  ActivityLog: new Map(),
};
let autoId = 1;

function extractTableName(sql) {
  const m = sql.match(/\b(?:FROM|INTO|UPDATE|TABLE)\s+([a-zA-Z0-9_]+)/i);
  return m ? m[1] : null;
}

function normalizeKey(k) {
  return k.replace(/^@/, '');
}

const db = {
  prepare(sql) {
    const rawSql = String(sql || '').trim();
    const table = extractTableName(rawSql) || 'Unknown';
    const store = tables[table] || (tables[table] = new Map());

    return {
      get(...args) {
        if (/SELECT\s+1\s+AS\s+ok/i.test(rawSql)) return { ok: 1 };
        if (/COUNT\(\*\)\s+AS\s+c/i.test(rawSql)) {
          return { c: store.size, total: store.size };
        }
        if (/COUNT\(\*\)\s+AS\s+total/i.test(rawSql)) {
          let pending = 0,
            failed = 0,
            synced = 0;
          for (const row of store.values()) {
            if (row.SyncStatus === 'pending') pending++;
            else if (row.SyncStatus === 'failed') failed++;
            else if (row.SyncStatus === 'synced') synced++;
          }
          return {
            total: store.size,
            pending,
            failed,
            synced,
            received: 0,
            accepted: 0,
            rejected: 0,
          };
        }
        if (/WHERE\s+Id\s*=\s*(?:\?|@Id)/i.test(rawSql)) {
          const id = typeof args[0] === 'object' ? args[0]?.Id : args[0];
          return store.get(Number(id)) || null;
        }
        if (/WHERE\s+FhirId\s*=\s*(?:\?|@FhirId)/i.test(rawSql)) {
          const fid = String(
            typeof args[0] === 'object' ? args[0]?.FhirId : args[0]
          );
          for (const r of store.values()) {
            if (String(r.FhirId) === fid) return r;
          }
          return null;
        }
        if (/WHERE\s+TaskFhirId\s*=\s*(?:\?|@TaskFhirId)/i.test(rawSql)) {
          const fid = String(
            typeof args[0] === 'object' ? args[0]?.TaskFhirId : args[0]
          );
          for (const r of store.values()) {
            if (String(r.TaskFhirId) === fid) return r;
          }
          return null;
        }
        if (/WHERE\s+NhfrCode\s*=\s*(?:\?|@NhfrCode)/i.test(rawSql)) {
          const code = String(
            typeof args[0] === 'object' ? args[0]?.NhfrCode : args[0]
          );
          for (const r of store.values()) {
            if (String(r.NhfrCode) === code) return r;
          }
          return null;
        }
        if (/WHERE\s+PhilSysId\s*=\s*(?:\?|@PhilSysId)/i.test(rawSql)) {
          const id = String(
            typeof args[0] === 'object' ? args[0]?.PhilSysId : args[0]
          );
          for (const r of store.values()) {
            if (String(r.PhilSysId) === id) return r;
          }
          return null;
        }
        if (/WHERE\s+PrcId\s*=\s*(?:\?|@PrcId)/i.test(rawSql)) {
          const id = String(
            typeof args[0] === 'object' ? args[0]?.PrcId : args[0]
          );
          for (const r of store.values()) {
            if (String(r.PrcId) === id) return r;
          }
          return null;
        }
        if (/WHERE\s+LocalCode\s*=\s*(?:\?|@LocalCode)/i.test(rawSql)) {
          const code = String(
            typeof args[0] === 'object' ? args[0]?.LocalCode : args[0]
          );
          for (const r of store.values()) {
            if (String(r.LocalCode) === code) return r;
          }
          return null;
        }
        for (const r of store.values()) return r;
        return null;
      },
      all(..._args) {
        if (/PRAGMA\s+table_info/i.test(rawSql)) {
          return [
            { name: 'Id' },
            { name: 'LocalCode' },
            { name: 'FhirId' },
            { name: 'RoleCode' },
            { name: 'RoleDisplay' },
            { name: 'RoleFhirId' },
            { name: 'OrganizationFhirId' },
            { name: 'Gender' },
            { name: 'WorkingImpressionCode' },
            { name: 'WorkingImpressionDisplay' },
            { name: 'LinkedConditionFhirId' },
            { name: 'LinkedDiagnosisText' },
          ];
        }
        const rows = Array.from(store.values());
        return rows.reverse();
      },
      run(params = {}) {
        if (/INSERT\s+INTO/i.test(rawSql)) {
          const id = autoId++;
          const row = {
            Id: id,
            CreatedAt: new Date().toISOString(),
            UpdatedAt: new Date().toISOString(),
          };
          if (params && typeof params === 'object') {
            for (const [k, v] of Object.entries(params)) {
              row[normalizeKey(k)] = v;
            }
          }
          store.set(id, row);
          return { lastInsertRowid: id, changes: 1 };
        }
        if (/UPDATE/i.test(rawSql)) {
          const id = Number(params.Id || params.id);
          const existing = store.get(id);
          if (existing && params && typeof params === 'object') {
            for (const [k, v] of Object.entries(params)) {
              const cleanKey = normalizeKey(k);
              if (v !== undefined) existing[cleanKey] = v;
            }
            existing.UpdatedAt = new Date().toISOString();
            store.set(id, existing);
          }
          return { lastInsertRowid: id, changes: existing ? 1 : 0 };
        }
        if (/DELETE/i.test(rawSql)) {
          const id = Number(
            typeof params === 'object' ? params.Id || params.id : params
          );
          const deleted = store.delete(id);
          return { lastInsertRowid: id, changes: deleted ? 1 : 0 };
        }
        return { lastInsertRowid: 1, changes: 1 };
      },
    };
  },
  exec() {},
  pragma() {},
  transaction(fn) {
    return fn;
  },
};

function ensureDefaultFacility() {
  const cfg = getDefaultFacilityConfig();
  if (!cfg) return null;
  const existing = db
    .prepare('SELECT * FROM Organizations WHERE FhirId = ?')
    .get(cfg.fhirId);
  if (existing) return existing;
  const insert = db.prepare(
    'INSERT INTO Organizations (LocalCode, Name, NhfrCode, HcpnCode, Phone, AddressLine, FhirId, SyncStatus) VALUES (@LocalCode, @Name, @NhfrCode, @HcpnCode, @Phone, @AddressLine, @FhirId, @SyncStatus)'
  );
  const info = insert.run({
    LocalCode: `${TEAM_PREFIX}-O0001`,
    Name: cfg.name,
    NhfrCode: cfg.nhfrCode,
    HcpnCode: cfg.hcpnCode,
    Phone: cfg.phone,
    AddressLine: cfg.addressLine,
    FhirId: cfg.fhirId,
    SyncStatus: 'synced',
  });
  return db
    .prepare('SELECT * FROM Organizations WHERE Id = ?')
    .get(info.lastInsertRowid);
}

const defaultFacilityRow = ensureDefaultFacility();

function checkDb() {
  return {
    status: 'disabled',
    message: 'Local DB disabled; app uses FHIR live server.',
  };
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
