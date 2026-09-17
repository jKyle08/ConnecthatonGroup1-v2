const { db } = require('./db');
const { searchPatients, putPatient } = require('./fhir');
const { logActivity } = require('./activity');

const TEAM_PREFIX = process.env.TEAM_PREFIX || 'TEAM07';

function findExisting(patient) {
  if (patient.fhirId) {
    const byFhir = db.prepare('SELECT * FROM Patients WHERE FhirId = ?').get(patient.fhirId);
    if (byFhir) return byFhir;
  }
  if (patient.philsysId && patient.philsysId !== '-') {
    return db.prepare('SELECT * FROM Patients WHERE PhilSysId = ?').get(patient.philsysId);
  }
  return null;
}

function nextLocalCode() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM Patients').get().c + 1;
  return `${TEAM_PREFIX}-P${String(count).padStart(4, '0')}`;
}

function upsertFromFhirPatient(patient) {
  const existing = findExisting(patient);
  const philsysId =
    patient.philsysId && patient.philsysId !== '-'
      ? patient.philsysId
      : `FHIR-${patient.fhirId || Date.now()}`;

  const payload = {
    PhilSysId: philsysId,
    PhilHealthId: patient.philhealthId || null,
    FamilyName: patient.familyName || 'Unknown',
    GivenName1: patient.givenName1 || 'Unknown',
    GivenName2: patient.givenName2 || null,
    Gender: patient.gender || 'unknown',
    BirthDate: patient.birthDate || '1900-01-01',
    Phone: patient.phone || null,
    AddressLine: patient.addressLine || null,
    RegionCode: patient.regionCode || null,
    RegionDisplay: patient.regionDisplay || null,
    ProvinceCode: patient.provinceCode || null,
    ProvinceDisplay: patient.provinceDisplay || null,
    CityCode: patient.cityCode || null,
    CityDisplay: patient.cityDisplay || null,
    BarangayCode: patient.barangayCode || null,
    BarangayDisplay: patient.barangayDisplay || null,
    PostalCode: patient.postalCode || null,
    NextOfKinFamily: patient.nextOfKinFamily || null,
    NextOfKinGiven: patient.nextOfKinGiven || null,
    FhirId: patient.fhirId || null,
  };

  if (existing) {
    db.prepare(`
      UPDATE Patients SET
        PhilSysId = @PhilSysId,
        PhilHealthId = @PhilHealthId,
        FamilyName = @FamilyName,
        GivenName1 = @GivenName1,
        GivenName2 = @GivenName2,
        Gender = @Gender,
        BirthDate = @BirthDate,
        Phone = @Phone,
        AddressLine = @AddressLine,
        RegionCode = @RegionCode,
        RegionDisplay = @RegionDisplay,
        ProvinceCode = @ProvinceCode,
        ProvinceDisplay = @ProvinceDisplay,
        CityCode = @CityCode,
        CityDisplay = @CityDisplay,
        BarangayCode = @BarangayCode,
        BarangayDisplay = @BarangayDisplay,
        PostalCode = @PostalCode,
        NextOfKinFamily = @NextOfKinFamily,
        NextOfKinGiven = @NextOfKinGiven,
        FhirId = @FhirId,
        SyncStatus = 'synced',
        SyncError = NULL,
        SyncedAt = datetime('now'),
        UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({ ...payload, Id: existing.Id });
    return { action: 'updated', id: existing.Id, localCode: existing.LocalCode };
  }

  const localCode = nextLocalCode();
  const info = db.prepare(`
    INSERT INTO Patients (
      LocalCode, PhilSysId, PhilHealthId, FamilyName, GivenName1, GivenName2,
      Gender, BirthDate, Phone, AddressLine,
      RegionCode, RegionDisplay, ProvinceCode, ProvinceDisplay,
      CityCode, CityDisplay, BarangayCode, BarangayDisplay, PostalCode,
      NextOfKinFamily, NextOfKinGiven, FhirId, SyncStatus, SyncedAt
    ) VALUES (
      @LocalCode, @PhilSysId, @PhilHealthId, @FamilyName, @GivenName1, @GivenName2,
      @Gender, @BirthDate, @Phone, @AddressLine,
      @RegionCode, @RegionDisplay, @ProvinceCode, @ProvinceDisplay,
      @CityCode, @CityDisplay, @BarangayCode, @BarangayDisplay, @PostalCode,
      @NextOfKinFamily, @NextOfKinGiven, @FhirId, 'synced', datetime('now')
    )
  `).run({ ...payload, LocalCode: localCode });

  return { action: 'inserted', id: info.lastInsertRowid, localCode };
}

async function pullPatientsFromFhir({ teamOnly = true, count = 100, q } = {}) {
  const remote = await searchPatients({ count, q: q || undefined });
  const filtered = teamOnly
    ? remote.filter((p) => {
        const id = `${p.philsysId || ''} ${p.localCode || ''}`.toUpperCase();
        return id.includes(String(TEAM_PREFIX).toUpperCase()) || id.includes('TEAM07');
      })
    : remote;

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const patient of filtered) {
    if (!patient.fhirId && (!patient.philsysId || patient.philsysId === '-')) {
      skipped += 1;
      continue;
    }
    const result = upsertFromFhirPatient(patient);
    if (result.action === 'inserted') inserted += 1;
    else updated += 1;
  }

  const summary = `Pull FHIR→Local: ${inserted} new, ${updated} updated, ${skipped} skipped (of ${filtered.length} matched / ${remote.length} fetched)`;
  logActivity({
    eventType: 'Sync',
    entityName: 'Patient pull',
    actionText: 'Pulled patients from FHIR to local DB',
    syncStatus: 'synced',
    details: summary,
    entity: 'patient',
    action: inserted > 0 ? 'created' : 'updated',
  });

  return {
    fetched: remote.length,
    matched: filtered.length,
    inserted,
    updated,
    skipped,
    teamOnly,
    teamPrefix: TEAM_PREFIX,
    message: summary,
  };
}

async function pushPendingToFhir() {
  const rows = db
    .prepare(`SELECT * FROM Patients WHERE SyncStatus IN ('pending', 'failed') ORDER BY Id`)
    .all();

  let synced = 0;
  let failed = 0;
  const errors = [];

  for (const row of rows) {
    try {
      const fhirResult = await putPatient(row);
      db.prepare(`
        UPDATE Patients
        SET FhirId = @FhirId,
            SyncStatus = 'synced',
            SyncError = NULL,
            SyncedAt = datetime('now'),
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({ Id: row.Id, FhirId: fhirResult.fhirId });
      synced += 1;
    } catch (err) {
      failed += 1;
      errors.push({ id: row.Id, error: err.message });
      db.prepare(`
        UPDATE Patients
        SET SyncStatus = 'failed',
            SyncError = @SyncError,
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({ Id: row.Id, SyncError: err.message });
    }
  }

  const summary = `Push Local→FHIR: ${synced} synced, ${failed} failed (of ${rows.length} pending/failed)`;
  logActivity({
    eventType: 'Sync',
    entityName: 'Patient push',
    actionText: 'Pushed pending local patients to FHIR',
    syncStatus: failed ? 'failed' : 'synced',
    details: summary,
    entity: 'patient',
    action: 'updated',
  });

  return { total: rows.length, synced, failed, errors, message: summary };
}

module.exports = {
  pullPatientsFromFhir,
  pushPendingToFhir,
  upsertFromFhirPatient,
};
