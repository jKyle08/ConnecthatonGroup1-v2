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

/** Split comma-separated SQL tokens, ignoring commas inside quotes/parens. */
function splitSqlList(text) {
  const out = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      cur += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function resolveSqlValue(raw, params = {}) {
  const v = String(raw || '').trim();
  if (!v) return undefined;
  if (/^NULL$/i.test(v)) return null;
  if (/^datetime\s*\(\s*'now'\s*\)$/i.test(v)) return new Date().toISOString();
  if (/^@(?:\w+)$/i.test(v) || /^\?$/.test(v)) {
    const key = normalizeKey(v);
    if (Object.prototype.hasOwnProperty.call(params, key)) return params[key];
    if (Object.prototype.hasOwnProperty.call(params, `@${key}`)) return params[`@${key}`];
    return undefined;
  }
  const str = v.match(/^'(.*)'$/s);
  if (str) return str[1].replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return undefined;
}

function applyInsertLiterals(rawSql, row, params = {}) {
  const m = rawSql.match(
    /INSERT\s+INTO\s+\w+\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]+)\)\s*$/i
  );
  if (!m) return;
  const cols = splitSqlList(m[1]);
  const vals = splitSqlList(m[2]);
  const n = Math.min(cols.length, vals.length);
  for (let i = 0; i < n; i++) {
    const col = cols[i].replace(/["`\[\]]/g, '').trim();
    if (!col || col === 'Id') continue;
    // Prefer explicit run() params; fall back to SQL literals like 'pending'.
    if (Object.prototype.hasOwnProperty.call(params, col) ||
        Object.prototype.hasOwnProperty.call(params, `@${col}`)) {
      continue;
    }
    const resolved = resolveSqlValue(vals[i], params);
    if (resolved !== undefined) row[col] = resolved;
  }
}

function applyUpdateLiterals(rawSql, row, params = {}) {
  const m = rawSql.match(/SET\s+([\s\S]+?)(?:\s+WHERE\b|$)/i);
  if (!m) return;
  for (const part of splitSqlList(m[1])) {
    const am = part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/);
    if (!am) continue;
    const col = am[1];
    if (col === 'Id') continue;
    const rhs = am[2].trim();
    // Bound params already applied from the params object; apply SQL literals / NULL / datetime.
    if (/^@/.test(rhs) || rhs === '?') continue;
    const resolved = resolveSqlValue(rhs, params);
    if (resolved !== undefined) row[col] = resolved;
  }
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
              const key = normalizeKey(k);
              // Never let a null/empty Id from callers wipe the generated key.
              if (key === 'Id' && (v == null || v === '')) continue;
              if (v !== undefined) row[key] = v;
            }
          }
          applyInsertLiterals(rawSql, row, params || {});
          row.Id = id;
          store.set(id, row);
          return { lastInsertRowid: id, changes: 1 };
        }
        if (/UPDATE/i.test(rawSql)) {
          const id = Number(params.Id || params.id);
          const existing = Number.isFinite(id) && id > 0 ? store.get(id) : null;
          if (existing && params && typeof params === 'object') {
            for (const [k, v] of Object.entries(params)) {
              const cleanKey = normalizeKey(k);
              if (cleanKey === 'Id') continue;
              if (v !== undefined) existing[cleanKey] = v;
            }
            applyUpdateLiterals(rawSql, existing, params);
            existing.Id = id;
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
