const { db } = require('./db');
const { broadcast } = require('./realtime');

const FHIR_COUNT_TTL_MS = 60_000;
let fhirCountCache = {
  patients: null,
  organizations: null,
  practitioners: null,
  at: 0,
};

function getLocalDashboardSnapshot() {
  const sync = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN SyncStatus = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN SyncStatus = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN SyncStatus = 'synced' THEN 1 ELSE 0 END) AS synced
    FROM Patients
  `).get();

  const orgCount = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN SyncStatus = 'synced' THEN 1 ELSE 0 END) AS synced
    FROM Organizations
  `).get();

  const pracCount = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN SyncStatus = 'synced' THEN 1 ELSE 0 END) AS synced
    FROM Practitioners
  `).get();

  const activity = db.prepare(`
    SELECT * FROM ActivityLog
    ORDER BY datetime(CreatedAt) DESC
    LIMIT 20
  `).all();

  let referralStats = { received: 0, accepted: 0, pending: 0, rejected: 0 };
  try {
    const ref = db.prepare(`
      SELECT
        SUM(CASE
          WHEN Direction = 'received'
            OR ReceivingOrgFhirId IN (SELECT FhirId FROM Organizations WHERE FhirId IS NOT NULL AND TRIM(FhirId) != '')
          THEN 1 ELSE 0 END) AS received,
        SUM(CASE WHEN TaskStatus = 'accepted' THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE
          WHEN (Direction = 'received'
            OR ReceivingOrgFhirId IN (SELECT FhirId FROM Organizations WHERE FhirId IS NOT NULL AND TRIM(FhirId) != ''))
            AND TaskStatus IN ('requested', 'in-progress', 'on-hold', 'received')
          THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN TaskStatus IN ('rejected', 'cancelled', 'failed') THEN 1 ELSE 0 END) AS rejected
      FROM Referrals
    `).get();
    referralStats = {
      received: Number(ref?.received || 0),
      accepted: Number(ref?.accepted || 0),
      pending: Number(ref?.pending || 0),
      rejected: Number(ref?.rejected || 0),
    };
  } catch {
    // Referrals table may not exist yet on older DBs mid-migration.
  }

  const patientTotal = Number(sync?.total || 0);
  const patientPending = Number(sync?.pending || 0);
  const patientFailed = Number(sync?.failed || 0);
  const patientSynced = Number(sync?.synced || 0);

  return {
    counts: {
      patients: patientTotal,
      organizations: Number(orgCount?.total || 0),
      organizationsSynced: Number(orgCount?.synced || 0),
      practitioners: Number(pracCount?.total || 0),
      practitionersSynced: Number(pracCount?.synced || 0),
      pendingSync: patientPending + patientFailed,
      activity: activity.length,
    },
    sync: {
      pending: patientPending,
      failed: patientFailed,
      synced: patientSynced,
    },
    referrals: referralStats,
    activity: activity.map((r) => ({
      id: r.Id,
      time: r.CreatedAt,
      type: r.EventType,
      name: r.EntityName,
      action: r.ActionText,
      syncStatus: r.SyncStatus,
      details: r.Details,
    })),
    source: {
      patients: 'local',
      organizations: 'local',
      practitioners: 'local',
    },
  };
}

async function refreshFhirCounts({ force = false } = {}) {
  const fresh =
    !force &&
    fhirCountCache.at &&
    Date.now() - fhirCountCache.at < FHIR_COUNT_TTL_MS &&
    fhirCountCache.patients != null;

  if (fresh) return fhirCountCache;

  let countFhirResources;
  try {
    ({ countFhirResources } = require('./fhir'));
  } catch {
    return fhirCountCache;
  }

  const [patients, organizations, practitioners] = await Promise.all([
    countFhirResources('Patient').catch(() => fhirCountCache.patients),
    countFhirResources('Organization').catch(() => fhirCountCache.organizations),
    countFhirResources('Practitioner').catch(() => fhirCountCache.practitioners),
  ]);

  fhirCountCache = {
    patients: patients == null ? fhirCountCache.patients : Number(patients),
    organizations:
      organizations == null ? fhirCountCache.organizations : Number(organizations),
    practitioners:
      practitioners == null ? fhirCountCache.practitioners : Number(practitioners),
    at: Date.now(),
  };
  return fhirCountCache;
}

function applyFhirCounts(snapshot, fhirCounts) {
  if (!snapshot || !fhirCounts) return snapshot;

  const localPatients = Number(snapshot.counts?.patients || 0);
  const localOrgs = Number(snapshot.counts?.organizations || 0);
  const localPracs = Number(snapshot.counts?.practitioners || 0);
  const pending = Number(snapshot.sync?.pending || 0);
  const failed = Number(snapshot.sync?.failed || 0);

  if (fhirCounts.patients != null) {
    const patients = Math.max(localPatients, Number(fhirCounts.patients) || 0);
    snapshot.counts.patients = patients;
    snapshot.sync.synced = Math.max(0, patients - pending - failed);
    snapshot.source.patients = 'fhir';
  }

  if (fhirCounts.organizations != null) {
    snapshot.counts.organizations = Math.max(
      localOrgs,
      Number(fhirCounts.organizations) || 0
    );
    snapshot.counts.organizationsSynced = snapshot.counts.organizations;
    snapshot.source.organizations = 'fhir';
  }

  if (fhirCounts.practitioners != null) {
    snapshot.counts.practitioners = Math.max(
      localPracs,
      Number(fhirCounts.practitioners) || 0
    );
    snapshot.counts.practitionersSynced = snapshot.counts.practitioners;
    snapshot.source.practitioners = 'fhir';
  }

  return snapshot;
}

function getDashboardSnapshot() {
  return applyFhirCounts(getLocalDashboardSnapshot(), fhirCountCache);
}

async function getDashboardSnapshotAsync({ forceFhir = false } = {}) {
  const snapshot = getLocalDashboardSnapshot();
  await refreshFhirCounts({ force: forceFhir });
  return applyFhirCounts(snapshot, fhirCountCache);
}

function publishDashboard() {
  try {
    broadcast('dashboardUpdated', getDashboardSnapshot());
    refreshFhirCounts()
      .then(() => broadcast('dashboardUpdated', getDashboardSnapshot()))
      .catch(() => {});
  } catch (err) {
    // Ignore publish failures so API writes still succeed.
  }
}

function publishEntityChanged(entity, action = 'changed', record = null) {
  broadcast('entityChanged', {
    entity,
    action,
    record,
    at: new Date().toISOString(),
  });
  publishDashboard();
}

function inferEntity(eventType) {
  const t = String(eventType || '').toLowerCase();
  if (t.includes('patient')) return 'patient';
  if (t.includes('organization')) return 'organization';
  if (t.includes('practitionerrole') || t.includes('practitioner-role') || t.includes('practitioner role')) {
    return 'practitioner-role';
  }
  if (t.includes('practitioner')) return 'practitioner';
  if (t.includes('referral')) return 'referral';
  if (t.includes('sync')) return 'sync';
  return null;
}

function logActivity({
  eventType,
  entityName,
  actionText,
  syncStatus,
  details,
  entity,
  action,
  record,
}) {
  const info = db.prepare(`
    INSERT INTO ActivityLog (EventType, EntityName, ActionText, SyncStatus, Details)
    VALUES (@eventType, @entityName, @actionText, @syncStatus, @details)
  `).run({
    eventType,
    entityName,
    actionText,
    syncStatus,
    details: details || null,
  });

  const entry = {
    id: Number(info.lastInsertRowid),
    time: new Date().toISOString(),
    type: eventType,
    name: entityName,
    action: actionText,
    syncStatus,
    details: details || null,
  };

  broadcast('activityLogged', entry);
  const resolvedEntity = entity || inferEntity(eventType);
  if (resolvedEntity) {
    publishEntityChanged(resolvedEntity, action || actionText, record || null);
  } else {
    publishDashboard();
  }

  return entry;
}

module.exports = {
  getDashboardSnapshot,
  getDashboardSnapshotAsync,
  publishDashboard,
  publishEntityChanged,
  logActivity,
};
