require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

/*
 * Persistent local SQLite is temporarily disabled.
 * Set USE_PERSISTENT_LOCAL_DB=true to restore ereferral-local.db on disk.
 * While disabled we keep an in-memory SQLite schema so existing route code
 * still compiles, but nothing is written to the local database file.
 */
const USE_PERSISTENT_LOCAL_DB =
  String(process.env.USE_PERSISTENT_LOCAL_DB || 'false').toLowerCase() === 'true';

// const dbPath = process.env.SQLITE_PATH || path.join(dataDir, 'ereferral-local.db');
// const db = new Database(dbPath);

const dbPath = USE_PERSISTENT_LOCAL_DB
  ? process.env.SQLITE_PATH || path.join(dataDir, 'ereferral-local.db')
  : ':memory:';
const db = new Database(dbPath);

if (USE_PERSISTENT_LOCAL_DB) {
  db.pragma('journal_mode = WAL');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS Patients (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    LocalCode TEXT NOT NULL UNIQUE,
    PhilSysId TEXT NOT NULL UNIQUE,
    PhilHealthId TEXT,
    FamilyName TEXT NOT NULL,
    GivenName1 TEXT NOT NULL,
    GivenName2 TEXT,
    Gender TEXT NOT NULL,
    BirthDate TEXT NOT NULL,
    Phone TEXT,
    AddressLine TEXT,
    RegionCode TEXT,
    RegionDisplay TEXT,
    ProvinceCode TEXT,
    ProvinceDisplay TEXT,
    CityCode TEXT,
    CityDisplay TEXT,
    BarangayCode TEXT,
    BarangayDisplay TEXT,
    PostalCode TEXT,
    NextOfKinFamily TEXT,
    NextOfKinGiven TEXT,
    FhirId TEXT,
    SyncStatus TEXT NOT NULL DEFAULT 'pending',
    SyncError TEXT,
    SyncedAt TEXT,
    CreatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    UpdatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS Organizations (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    LocalCode TEXT NOT NULL UNIQUE,
    Name TEXT NOT NULL,
    NhfrCode TEXT NOT NULL UNIQUE,
    HcpnCode TEXT,
    Phone TEXT,
    AddressLine TEXT,
    RegionCode TEXT,
    RegionDisplay TEXT,
    ProvinceCode TEXT,
    ProvinceDisplay TEXT,
    CityCode TEXT,
    CityDisplay TEXT,
    BarangayCode TEXT,
    BarangayDisplay TEXT,
    PostalCode TEXT,
    FhirId TEXT,
    SyncStatus TEXT NOT NULL DEFAULT 'pending',
    SyncError TEXT,
    SyncedAt TEXT,
    CreatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    UpdatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS Practitioners (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    LocalCode TEXT NOT NULL UNIQUE,
    PrcId TEXT NOT NULL UNIQUE,
    FamilyName TEXT NOT NULL,
    GivenName TEXT NOT NULL,
    Prefix TEXT,
    Phone TEXT,
    RoleCode TEXT,
    RoleDisplay TEXT,
    RoleFhirId TEXT,
    OrganizationFhirId TEXT,
    FhirId TEXT,
    SyncStatus TEXT NOT NULL DEFAULT 'pending',
    SyncError TEXT,
    SyncedAt TEXT,
    CreatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    UpdatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS PractitionerRoles (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    LocalCode TEXT NOT NULL UNIQUE,
    PrcId TEXT NOT NULL,
    PractitionerFhirId TEXT,
    PractitionerName TEXT,
    OrganizationFhirId TEXT,
    OrganizationName TEXT,
    RoleCode TEXT NOT NULL,
    RoleDisplay TEXT NOT NULL,
    Active INTEGER NOT NULL DEFAULT 1,
    FhirId TEXT,
    SyncStatus TEXT NOT NULL DEFAULT 'pending',
    SyncError TEXT,
    SyncedAt TEXT,
    CreatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    UpdatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ActivityLog (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    EventType TEXT NOT NULL,
    EntityName TEXT NOT NULL,
    ActionText TEXT NOT NULL,
    SyncStatus TEXT NOT NULL,
    Details TEXT,
    CreatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS Referrals (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    LocalCode TEXT NOT NULL UNIQUE,
    RequisitionValue TEXT NOT NULL UNIQUE,
    PatientId INTEGER,
    PatientFhirId TEXT,
    PatientName TEXT,
    SendingOrgId INTEGER,
    SendingOrgFhirId TEXT,
    SendingOrgName TEXT,
    ReceivingOrgId INTEGER,
    ReceivingOrgFhirId TEXT,
    ReceivingOrgName TEXT,
    SendingPracId INTEGER,
    SendingPracFhirId TEXT,
    SendingPracName TEXT,
    ReceivingPracId INTEGER,
    ReceivingPracFhirId TEXT,
    ReceivingPracName TEXT,
    CategoryCode TEXT,
    CategoryDisplay TEXT,
    CategoryText TEXT,
    ReasonCode TEXT,
    ReasonDisplay TEXT,
    ReasonText TEXT,
    ChiefComplaint TEXT,
    WorkingImpression TEXT,
    ClinicalHistory TEXT,
    TreatmentGiven TEXT,
    BpSystolic REAL,
    BpDiastolic REAL,
    HeartRate REAL,
    RespiratoryRate REAL,
    OxygenSaturation REAL,
    Temperature REAL,
    Weight REAL,
    LabConclusion TEXT,
    ReferralNote TEXT,
    TaskNote TEXT,
    DateOfReferral TEXT,
    ServiceRequestFhirId TEXT,
    TaskFhirId TEXT,
    EncounterFhirId TEXT,
    TaskStatus TEXT NOT NULL DEFAULT 'requested',
    Direction TEXT NOT NULL DEFAULT 'sent',
    SyncStatus TEXT NOT NULL DEFAULT 'pending',
    SyncError TEXT,
    SyncedAt TEXT,
    CreatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    UpdatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function ensureColumn(table, column, typeSql) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`);
  }
}

ensureColumn('Practitioners', 'RoleCode', 'TEXT');
ensureColumn('Practitioners', 'RoleDisplay', 'TEXT');
ensureColumn('Practitioners', 'RoleFhirId', 'TEXT');
ensureColumn('Practitioners', 'OrganizationFhirId', 'TEXT');
ensureColumn('Practitioners', 'Gender', 'TEXT');
ensureColumn('Referrals', 'WorkingImpressionCode', 'TEXT');
ensureColumn('Referrals', 'WorkingImpressionDisplay', 'TEXT');
ensureColumn('Referrals', 'LinkedConditionFhirId', 'TEXT');
ensureColumn('Referrals', 'LinkedDiagnosisText', 'TEXT');

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

  const byFhir = db
    .prepare('SELECT * FROM Organizations WHERE FhirId = ?')
    .get(cfg.fhirId);
  if (byFhir) {
    db.prepare(`
      UPDATE Organizations SET
        Name = @Name,
        NhfrCode = @NhfrCode,
        HcpnCode = COALESCE(@HcpnCode, HcpnCode),
        Phone = COALESCE(@Phone, Phone),
        AddressLine = COALESCE(@AddressLine, AddressLine),
        SyncStatus = 'synced',
        SyncError = NULL,
        SyncedAt = COALESCE(SyncedAt, datetime('now')),
        UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({
      Id: byFhir.Id,
      Name: cfg.name,
      NhfrCode: cfg.nhfrCode,
      HcpnCode: cfg.hcpnCode,
      Phone: cfg.phone,
      AddressLine: cfg.addressLine,
    });
    return db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(byFhir.Id);
  }

  const byNhfr = db
    .prepare('SELECT * FROM Organizations WHERE NhfrCode = ?')
    .get(cfg.nhfrCode);
  if (byNhfr) {
    db.prepare(`
      UPDATE Organizations SET
        Name = @Name,
        FhirId = @FhirId,
        HcpnCode = COALESCE(@HcpnCode, HcpnCode),
        Phone = COALESCE(@Phone, Phone),
        AddressLine = COALESCE(@AddressLine, AddressLine),
        SyncStatus = 'synced',
        SyncError = NULL,
        SyncedAt = COALESCE(SyncedAt, datetime('now')),
        UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({
      Id: byNhfr.Id,
      Name: cfg.name,
      FhirId: cfg.fhirId,
      HcpnCode: cfg.hcpnCode,
      Phone: cfg.phone,
      AddressLine: cfg.addressLine,
    });
    return db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(byNhfr.Id);
  }

  const nextNum =
    db.prepare('SELECT COUNT(*) AS c FROM Organizations').get().c + 1;
  const localCode = `${TEAM_PREFIX}-O${String(nextNum).padStart(4, '0')}`;
  const info = db
    .prepare(
      `
      INSERT INTO Organizations (
        LocalCode, Name, NhfrCode, HcpnCode, Phone, AddressLine,
        FhirId, SyncStatus, SyncedAt
      ) VALUES (
        @LocalCode, @Name, @NhfrCode, @HcpnCode, @Phone, @AddressLine,
        @FhirId, 'synced', datetime('now')
      )
    `
    )
    .run({
      LocalCode: localCode,
      Name: cfg.name,
      NhfrCode: cfg.nhfrCode,
      HcpnCode: cfg.hcpnCode,
      Phone: cfg.phone,
      AddressLine: cfg.addressLine,
      FhirId: cfg.fhirId,
    });

  return db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(info.lastInsertRowid);
}

const defaultFacilityRow = ensureDefaultFacility();

function checkDb() {
  if (!USE_PERSISTENT_LOCAL_DB) {
    const err = new Error(
      'Persistent local DB temporarily disabled (USE_PERSISTENT_LOCAL_DB=false)'
    );
    err.code = 'LOCAL_DB_DISABLED';
    throw err;
  }
  db.prepare('SELECT 1 AS ok').get();
  return true;
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
