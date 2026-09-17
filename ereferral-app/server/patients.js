const express = require('express');
const { db } = require('./db');
const {
  putPatient,
  updatePatientById,
  getPatient,
  searchPatients,
  matchesQuery,
  searchTypedResources,
  summarizeCondition,
  deleteResource,
  fetchPatientHistory,
} = require('./fhir');
const { logActivity } = require('./activity');

const router = express.Router();
const TEAM_PREFIX = process.env.TEAM_PREFIX || 'TEAM07';

function mapPatient(row) {
  if (!row) return null;
  return {
    id: row.Id,
    localCode: row.LocalCode,
    philsysId: row.PhilSysId,
    philhealthId: row.PhilHealthId,
    familyName: row.FamilyName,
    givenName1: row.GivenName1,
    givenName2: row.GivenName2,
    gender: row.Gender,
    birthDate: row.BirthDate ? String(row.BirthDate).slice(0, 10) : null,
    phone: row.Phone,
    addressLine: row.AddressLine,
    regionCode: row.RegionCode,
    regionDisplay: row.RegionDisplay,
    provinceCode: row.ProvinceCode,
    provinceDisplay: row.ProvinceDisplay,
    cityCode: row.CityCode,
    cityDisplay: row.CityDisplay,
    barangayCode: row.BarangayCode,
    barangayDisplay: row.BarangayDisplay,
    postalCode: row.PostalCode,
    nextOfKinFamily: row.NextOfKinFamily,
    nextOfKinGiven: row.NextOfKinGiven,
    fhirId: row.FhirId,
    syncStatus: row.SyncStatus,
    syncError: row.SyncError,
    syncedAt: row.SyncedAt,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
    source: 'local',
  };
}

function paginate(items, page, pageSize) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    patients: items.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

function patientRecency(p) {
  return Date.parse(p.createdAt || p.updatedAt || p.syncedAt || '') || 0;
}

function sortPatientsNewestFirst(patients) {
  return [...patients].sort((a, b) => {
    const tb = patientRecency(b);
    const ta = patientRecency(a);
    if (tb !== ta) return tb - ta;
    const fb = Number(b.fhirId) || 0;
    const fa = Number(a.fhirId) || 0;
    if (fb !== fa) return fb - fa;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}

const PATIENT_WRITE_REQUIRED = ['philsysId', 'familyName', 'givenName1', 'gender', 'birthDate'];

function missingPatientWriteFields(b) {
  return PATIENT_WRITE_REQUIRED.filter((k) => !b[k]);
}

function patientWriteParams(b, localId) {
  return {
    Id: localId,
    PhilSysId: b.philsysId,
    PhilHealthId: b.philhealthId || null,
    FamilyName: b.familyName,
    GivenName1: b.givenName1,
    GivenName2: b.givenName2 || null,
    Gender: b.gender,
    BirthDate: b.birthDate,
    Phone: b.phone || null,
    AddressLine: b.addressLine || null,
    RegionCode: b.regionCode || null,
    RegionDisplay: b.regionDisplay || null,
    ProvinceCode: b.provinceCode || null,
    ProvinceDisplay: b.provinceDisplay || null,
    CityCode: b.cityCode || null,
    CityDisplay: b.cityDisplay || null,
    BarangayCode: b.barangayCode || null,
    BarangayDisplay: b.barangayDisplay || null,
    PostalCode: b.postalCode || null,
    NextOfKinFamily: b.nextOfKinFamily || null,
    NextOfKinGiven: b.nextOfKinGiven || null,
  };
}

async function syncLocalPatientToFhir(row, { action, actionTextOk, actionTextFail }) {
  const displayName = `${row.GivenName1} ${row.FamilyName} (${row.LocalCode})`;
  let fhirResult = null;
  try {
    if (row.FhirId) {
      fhirResult = await updatePatientById(row.FhirId, row);
    } else {
      fhirResult = await putPatient(row);
    }
    db.prepare(`
      UPDATE Patients
      SET FhirId = @FhirId,
          SyncStatus = 'synced',
          SyncError = NULL,
          SyncedAt = datetime('now'),
          UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({ Id: row.Id, FhirId: fhirResult.fhirId });
    row = db.prepare('SELECT * FROM Patients WHERE Id = ?').get(row.Id);
    logActivity({
      eventType: 'Patient',
      entityName: displayName,
      actionText: actionTextOk,
      syncStatus: 'synced',
      details: `FHIR ID: ${fhirResult.fhirId}`,
      action,
      record: mapPatient(row),
    });
  } catch (fhirErr) {
    db.prepare(`
      UPDATE Patients
      SET SyncStatus = 'failed',
          SyncError = @SyncError,
          UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({ Id: row.Id, SyncError: fhirErr.message });
    row = db.prepare('SELECT * FROM Patients WHERE Id = ?').get(row.Id);
    logActivity({
      eventType: 'Patient',
      entityName: displayName,
      actionText: actionTextFail,
      syncStatus: 'failed',
      details: String(fhirErr.message).slice(0, 480),
      action,
      record: mapPatient(row),
    });
  }
  return { row, fhirResult };
}

async function createLocalPatient(b) {
  const nextNum = db.prepare('SELECT COUNT(*) AS c FROM Patients').get().c + 1;
  const localCode = b.localCode || `${TEAM_PREFIX}-P${String(nextNum).padStart(4, '0')}`;

  const insert = db.prepare(`
    INSERT INTO Patients (
      LocalCode, PhilSysId, PhilHealthId, FamilyName, GivenName1, GivenName2,
      Gender, BirthDate, Phone, AddressLine,
      RegionCode, RegionDisplay, ProvinceCode, ProvinceDisplay,
      CityCode, CityDisplay, BarangayCode, BarangayDisplay, PostalCode,
      NextOfKinFamily, NextOfKinGiven, SyncStatus
    ) VALUES (
      @LocalCode, @PhilSysId, @PhilHealthId, @FamilyName, @GivenName1, @GivenName2,
      @Gender, @BirthDate, @Phone, @AddressLine,
      @RegionCode, @RegionDisplay, @ProvinceCode, @ProvinceDisplay,
      @CityCode, @CityDisplay, @BarangayCode, @BarangayDisplay, @PostalCode,
      @NextOfKinFamily, @NextOfKinGiven, 'pending'
    )
  `);

  const info = insert.run({
    LocalCode: localCode,
    ...patientWriteParams(b, null),
  });

  let row = db.prepare('SELECT * FROM Patients WHERE Id = ?').get(info.lastInsertRowid);
  const { row: syncedRow, fhirResult } = await syncLocalPatientToFhir(row, {
    action: 'created',
    actionTextOk: 'Patient saved',
    actionTextFail: 'Patient saved (FHIR failed)',
  });
  return {
    patient: mapPatient(syncedRow),
    fhir: fhirResult ? { id: fhirResult.fhirId, status: fhirResult.status } : null,
  };
}

async function updateLocalPatient(localId, b) {
  const existing = db.prepare('SELECT * FROM Patients WHERE Id = ?').get(Number(localId));
  if (!existing) {
    const err = new Error('Patient not found');
    err.status = 404;
    throw err;
  }

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
      UpdatedAt = datetime('now')
    WHERE Id = @Id
  `).run(patientWriteParams(b, existing.Id));

  let row = db.prepare('SELECT * FROM Patients WHERE Id = ?').get(existing.Id);
  const { row: syncedRow, fhirResult } = await syncLocalPatientToFhir(row, {
    action: 'updated',
    actionTextOk: 'Patient updated',
    actionTextFail: 'Patient updated (FHIR failed)',
  });
  return {
    patient: mapPatient(syncedRow),
    fhir: fhirResult ? { id: fhirResult.fhirId, status: fhirResult.status } : null,
  };
}

function handlePatientWriteError(err, res) {
  const msg = err.message || String(err);
  if (err.status === 404) {
    return res.status(404).json({ error: msg });
  }
  if (msg.toLowerCase().includes('unique')) {
    return res.status(409).json({
      error: 'Patient with this PhilSys ID or Local Code already exists locally.',
    });
  }
  return res.status(500).json({ error: msg });
}

function mergeFhirWithLocal(fhirPatients, localPatients) {
  const byFhirId = new Map();
  const byPhilsys = new Map();
  for (const local of localPatients) {
    if (local.fhirId) byFhirId.set(String(local.fhirId), local);
    if (local.philsysId && local.philsysId !== '-') {
      byPhilsys.set(String(local.philsysId), local);
    }
  }

  const usedLocalIds = new Set();
  const merged = fhirPatients.map((fp) => {
    const local =
      (fp.fhirId && byFhirId.get(String(fp.fhirId))) ||
      (fp.philsysId && fp.philsysId !== '-' && byPhilsys.get(String(fp.philsysId))) ||
      null;
    if (!local) return { ...fp, source: 'fhir' };
    usedLocalIds.add(local.id);
    return {
      ...fp,
      id: local.id,
      localCode:
        local.localCode && local.localCode !== '-' ? local.localCode : fp.localCode,
      syncStatus: local.syncStatus || fp.syncStatus || 'synced',
      syncError: local.syncError || null,
      syncedAt: local.syncedAt || fp.syncedAt,
      createdAt: local.createdAt || fp.createdAt,
      updatedAt: local.updatedAt || fp.updatedAt,
      source: 'fhir',
    };
  });

  const localOnly = localPatients
    .filter((local) => !usedLocalIds.has(local.id))
    .map((local) => ({ ...local, source: local.fhirId ? 'fhir' : 'local' }));

  return sortPatientsNewestFirst([...localOnly, ...merged]);
}

function loadLocalPatients() {
  try {
    return db
      .prepare('SELECT * FROM Patients ORDER BY datetime(CreatedAt) DESC')
      .all()
      .map(mapPatient);
  } catch {
    return [];
  }
}

router.get('/', async (req, res) => {
  const sourcePref = String(req.query.source || 'fhir').toLowerCase();
  const forceLocal = sourcePref === 'local';
  const q = String(req.query.q || '').trim();
  const wantsPage = req.query.page != null || req.query.pageSize != null;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));
  const count = Math.min(500, Math.max(1, Number(req.query.count) || 200));
  const localPatients = loadLocalPatients();

  if (forceLocal) {
    let patients = localPatients;
    if (q) patients = patients.filter((p) => matchesQuery(p, q));
    patients = sortPatientsNewestFirst(patients);
    if (wantsPage) {
      return res.json({
        source: 'local',
        warning: null,
        ...paginate(patients, page, pageSize),
      });
    }
    return res.json({
      source: 'local',
      warning: null,
      patients,
      total: patients.length,
    });
  }

  try {
    const fhirPatients = await searchPatients({
      count,
      q: q || undefined,
      all: true,
      maxPages: 100,
    });

    let patients = mergeFhirWithLocal(fhirPatients, localPatients);
    if (q) patients = patients.filter((p) => matchesQuery(p, q));

    const warning = `Loaded ${patients.length} patient(s) from FHIR${
      localPatients.length ? ` (merged with ${localPatients.length} local)` : ''
    }.`;

    if (wantsPage) {
      return res.json({
        source: 'fhir',
        warning,
        ...paginate(patients, page, pageSize),
      });
    }
    return res.json({
      source: 'fhir',
      warning,
      patients,
      total: patients.length,
    });
  } catch (err) {
    const detail = err.cause?.message || err.message || 'Unknown error';
    let patients = localPatients;
    if (q) patients = patients.filter((p) => matchesQuery(p, q));
    patients = sortPatientsNewestFirst(patients);
    if (patients.length) {
      const warning = `FHIR Patient API unavailable (${detail}). Showing ${patients.length} local record(s).`;
      if (wantsPage) {
        return res.json({
          source: 'local',
          warning,
          ...paginate(patients, page, pageSize),
        });
      }
      return res.json({
        source: 'local',
        warning,
        patients,
        total: patients.length,
      });
    }
    res.status(502).json({
      error: `Could not fetch patients from FHIR API: ${detail}`,
    });
  }
});

router.get('/fhir/:fhirId/conditions', async (req, res) => {
  try {
    const fhirId = String(req.params.fhirId || '').trim();
    if (!fhirId) return res.status(400).json({ error: 'fhirId is required' });
    const resources = await searchTypedResources('Condition', {
      patientFhirId: fhirId,
      count: Math.min(100, Number(req.query.count) || 50),
    });
    const conditions = resources.map(summarizeCondition).filter(Boolean);
    res.json({ patientFhirId: fhirId, conditions, total: conditions.length });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/fhir/:fhirId/history', async (req, res) => {
  const fhirId = String(req.params.fhirId || '').trim();
  if (!fhirId) return res.status(400).json({ error: 'Patient FHIR ID is required.' });

  try {
    const count = Math.min(100, Math.max(1, Number(req.query.count) || 50));
    const history = await fetchPatientHistory(fhirId, { count });
    res.json({
      ok: true,
      purpose: 'revision-timeline',
      bundleType: 'history',
      patientFhirId: fhirId,
      total: history.total,
      timeline: history.timeline,
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.get('/fhir/:fhirId', async (req, res) => {
  try {
    const patient = await getPatient(req.params.fhirId);
    res.json(patient);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/:id/conditions', async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM Patients WHERE Id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Patient not found' });
    if (!row.FhirId) {
      return res.json({
        patientId: row.Id,
        patientFhirId: null,
        conditions: [],
        total: 0,
        message: 'Patient is not synced to FHIR yet. Sync the patient to load existing conditions.',
      });
    }
    const resources = await searchTypedResources('Condition', {
      patientFhirId: row.FhirId,
      count: Math.min(100, Number(req.query.count) || 50),
    });
    const conditions = resources.map(summarizeCondition).filter(Boolean);
    res.json({
      patientId: row.Id,
      patientFhirId: row.FhirId,
      conditions,
      total: conditions.length,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM Patients WHERE Id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Patient not found' });
    res.json(mapPatient(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function upsertPatientAtRoot(req, res, { createdStatus = 200 }) {
  const b = req.body || {};
  const missing = missingPatientWriteFields(b);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  try {
    const existing = db
      .prepare('SELECT * FROM Patients WHERE PhilSysId = ?')
      .get(b.philsysId);
    if (existing) {
      const payload = await updateLocalPatient(existing.Id, b);
      return res.json(payload);
    }
    const payload = await createLocalPatient(b);
    return res.status(createdStatus).json(payload);
  } catch (err) {
    return handlePatientWriteError(err, res);
  }
}

router.put('/', (req, res) => upsertPatientAtRoot(req, res, { createdStatus: 200 }));

router.post('/', (req, res) => upsertPatientAtRoot(req, res, { createdStatus: 201 }));

router.put('/fhir/:fhirId', async (req, res) => {
  const b = req.body || {};
  const required = ['philsysId', 'familyName', 'givenName1', 'gender', 'birthDate'];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  try {
    const fhirResult = await updatePatientById(req.params.fhirId, b);
    let patient = null;
    try {
      patient = await getPatient(req.params.fhirId);
    } catch {
      patient = null;
    }
    // Keep the golden FHIR ID in the UI, and reflect the values just saved
    // (MDM may take a moment to project them onto the golden record).
    patient = {
      ...(patient || {}),
      fhirId: String(req.params.fhirId),
      philsysId: b.philsysId,
      philhealthId: b.philhealthId || patient?.philhealthId || null,
      familyName: b.familyName,
      givenName1: b.givenName1,
      givenName2: b.givenName2 || null,
      gender: b.gender,
      birthDate: b.birthDate,
      phone: b.phone || null,
      addressLine: b.addressLine || null,
      regionCode: b.regionCode || null,
      regionDisplay: b.regionDisplay || null,
      provinceCode: b.provinceCode || null,
      provinceDisplay: b.provinceDisplay || null,
      cityCode: b.cityCode || null,
      cityDisplay: b.cityDisplay || null,
      barangayCode: b.barangayCode || null,
      barangayDisplay: b.barangayDisplay || null,
      postalCode: b.postalCode || null,
      nextOfKinFamily: b.nextOfKinFamily || null,
      nextOfKinGiven: b.nextOfKinGiven || null,
      syncStatus: 'synced',
      source: 'fhir',
    };
    logActivity({
      eventType: 'Patient',
      entityName: `${b.givenName1} ${b.familyName}`,
      actionText: fhirResult.mdm
        ? 'Patient updated via MDM source'
        : 'Patient updated on FHIR',
      syncStatus: 'synced',
      details: fhirResult.sourceFhirId
        ? `Golden FHIR ID: ${req.params.fhirId}; Source: ${fhirResult.sourceFhirId}`
        : `FHIR ID: ${req.params.fhirId}`,
      action: 'updated',
      record: patient,
    });
    res.json({
      patient,
      fhir: {
        id: fhirResult.fhirId,
        sourceId: fhirResult.sourceFhirId || null,
        status: fhirResult.status,
        mdm: Boolean(fhirResult.mdm),
      },
    });
  } catch (err) {
    const msg = err.message || String(err);
    if (/HAPI-0765|managed by MDM/i.test(msg)) {
      return res.status(403).json({
        error:
          'This patient is an MDM golden record and cannot be edited directly. Retry after the server reloads MDM-aware save handling.',
      });
    }
    res.status(err.status || 500).json({ error: msg });
  }
});

router.put('/:id', async (req, res) => {
  const b = req.body || {};
  const missing = missingPatientWriteFields(b);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  try {
    const payload = await updateLocalPatient(req.params.id, b);
    res.json(payload);
  } catch (err) {
    handlePatientWriteError(err, res);
  }
});

router.post('/:id/sync', async (req, res) => {
  try {
    let row = db.prepare('SELECT * FROM Patients WHERE Id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Patient not found' });

    const displayName = `${row.GivenName1} ${row.FamilyName} (${row.LocalCode})`;
    const fhirResult = row.FhirId
      ? await updatePatientById(row.FhirId, row)
      : await putPatient(row);

    db.prepare(`
      UPDATE Patients
      SET FhirId = @FhirId,
          SyncStatus = 'synced',
          SyncError = NULL,
          SyncedAt = datetime('now'),
          UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({ Id: row.Id, FhirId: fhirResult.fhirId });

    row = db.prepare('SELECT * FROM Patients WHERE Id = ?').get(row.Id);
    logActivity({
      eventType: 'Patient',
      entityName: displayName,
      actionText: 'Patient re-synced',
      syncStatus: 'synced',
      details: `FHIR ID: ${fhirResult.fhirId}`,
      action: 'updated',
      record: mapPatient(row),
    });

    res.json({
      patient: mapPatient(row),
      fhir: { id: fhirResult.fhirId, status: fhirResult.status },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/fhir/:fhirId', async (req, res) => {
  const fhirId = String(req.params.fhirId || '').trim();
  if (!fhirId) return res.status(400).json({ error: 'FHIR ID is required' });

  try {
    const local = db.prepare('SELECT * FROM Patients WHERE FhirId = ?').get(fhirId);
    if (local) {
      db.prepare('DELETE FROM Patients WHERE Id = ?').run(local.Id);
    }

    let fhir = null;
    let fhirWarning = null;
    try {
      fhir = await deleteResource('Patient', fhirId);
    } catch (fhirErr) {
      fhirWarning = fhirErr.message;
    }

    const displayName = local
      ? `${local.GivenName1} ${local.FamilyName} (${local.LocalCode})`
      : `Patient/${fhirId}`;
    logActivity({
      eventType: 'Patient',
      entityName: displayName,
      actionText: fhirWarning ? 'Patient deleted (FHIR warning)' : 'Patient deleted',
      syncStatus: fhirWarning ? 'failed' : 'synced',
      details: fhirWarning || `FHIR ID: ${fhirId}`,
      action: 'deleted',
      record: local ? mapPatient(local) : { fhirId },
    });

    res.json({
      ok: true,
      deletedLocal: Boolean(local),
      fhir,
      fhirWarning,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM Patients WHERE Id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Patient not found' });

    const displayName = `${row.GivenName1} ${row.FamilyName} (${row.LocalCode})`;
    let fhir = null;
    let fhirWarning = null;

    if (row.FhirId) {
      try {
        fhir = await deleteResource('Patient', row.FhirId);
      } catch (fhirErr) {
        fhirWarning = fhirErr.message;
      }
    }

    db.prepare('DELETE FROM Patients WHERE Id = ?').run(row.Id);

    logActivity({
      eventType: 'Patient',
      entityName: displayName,
      actionText: fhirWarning ? 'Patient deleted (FHIR warning)' : 'Patient deleted',
      syncStatus: fhirWarning ? 'failed' : 'synced',
      details: fhirWarning || (row.FhirId ? `FHIR ID: ${row.FhirId}` : 'Local only'),
      action: 'deleted',
      record: mapPatient(row),
    });

    res.json({
      ok: true,
      deletedLocal: true,
      fhir,
      fhirWarning,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
