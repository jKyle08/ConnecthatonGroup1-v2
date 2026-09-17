const express = require('express');
const { db } = require('./db');
const {
  searchTasks,
  summarizeIncomingTaskList,
  loadIncomingReferralPackage,
  loadReferralCollectionBundle,
  fetchTaskHistory,
  updateTaskStatus,
  transferIncomingReferral,
  getTask,
} = require('./fhir');
const { logActivity, publishDashboard } = require('./activity');

const router = express.Router();
const TEAM_PREFIX = process.env.TEAM_PREFIX || 'TEAM07';

function mapReferral(row) {
  if (!row) return null;
  return {
    id: row.Id,
    localCode: row.LocalCode,
    requisitionValue: row.RequisitionValue,
    patientId: row.PatientId,
    patientFhirId: row.PatientFhirId,
    patientName: row.PatientName,
    sendingOrgId: row.SendingOrgId,
    sendingOrgFhirId: row.SendingOrgFhirId,
    sendingOrgName: row.SendingOrgName,
    receivingOrgId: row.ReceivingOrgId,
    receivingOrgFhirId: row.ReceivingOrgFhirId,
    receivingOrgName: row.ReceivingOrgName,
    sendingPracId: row.SendingPracId,
    sendingPracFhirId: row.SendingPracFhirId,
    sendingPracName: row.SendingPracName,
    receivingPracId: row.ReceivingPracId,
    receivingPracFhirId: row.ReceivingPracFhirId,
    receivingPracName: row.ReceivingPracName,
    categoryCode: row.CategoryCode,
    categoryDisplay: row.CategoryDisplay,
    categoryText: row.CategoryText,
    reasonCode: row.ReasonCode,
    reasonDisplay: row.ReasonDisplay,
    reasonText: row.ReasonText,
    chiefComplaint: row.ChiefComplaint,
    workingImpression: row.WorkingImpression,
    clinicalHistory: row.ClinicalHistory,
    treatmentGiven: row.TreatmentGiven,
    labConclusion: row.LabConclusion,
    referralNote: row.ReferralNote,
    taskNote: row.TaskNote,
    dateOfReferral: row.DateOfReferral,
    serviceRequestFhirId: row.ServiceRequestFhirId,
    taskFhirId: row.TaskFhirId,
    encounterFhirId: row.EncounterFhirId,
    taskStatus: row.TaskStatus,
    direction: row.Direction,
    syncStatus: row.SyncStatus,
    syncError: row.SyncError,
    syncedAt: row.SyncedAt,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
    source: 'local',
  };
}

function localOrgFhirIds() {
  return db
    .prepare(
      `SELECT FhirId FROM Organizations WHERE FhirId IS NOT NULL AND TRIM(FhirId) != ''`
    )
    .all()
    .map((r) => String(r.FhirId));
}

function isIncomingRow(row, orgFhirIds = localOrgFhirIds()) {
  if (!row) return false;
  if (String(row.Direction || '').toLowerCase() === 'received') return true;
  if (
    orgFhirIds.length &&
    row.ReceivingOrgFhirId &&
    orgFhirIds.includes(String(row.ReceivingOrgFhirId))
  ) {
    return true;
  }
  return false;
}

function listIncomingRows({ status, q, receivingOrgFhirId } = {}) {
  const orgIds = localOrgFhirIds();
  let rows = db
    .prepare(
      `SELECT * FROM Referrals ORDER BY datetime(COALESCE(DateOfReferral, CreatedAt)) DESC`
    )
    .all()
    .filter((row) => isIncomingRow(row, orgIds));

  if (status && status !== 'all') {
    const wanted = String(status).toLowerCase();
    rows = rows.filter((r) => String(r.TaskStatus || '').toLowerCase() === wanted);
  }

  if (receivingOrgFhirId) {
    const facilityId = String(receivingOrgFhirId).trim();
    rows = rows.filter((r) => String(r.ReceivingOrgFhirId || '') === facilityId);
  }

  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((r) =>
      [
        r.LocalCode,
        r.RequisitionValue,
        r.PatientName,
        r.SendingOrgName,
        r.ReceivingOrgName,
        r.SendingPracName,
        r.ReceivingPracName,
        r.ServiceRequestFhirId,
        r.TaskFhirId,
        r.TaskStatus,
        r.ReasonText,
        r.CategoryText,
        r.ChiefComplaint,
        r.WorkingImpression,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }

  return rows;
}

function upsertIncomingReferral(mapped) {
  const existing = mapped.taskFhirId
    ? db.prepare('SELECT * FROM Referrals WHERE TaskFhirId = ?').get(mapped.taskFhirId)
    : null;

  const fields = {
    TaskStatus: mapped.taskStatus || 'requested',
    ServiceRequestFhirId: mapped.serviceRequestFhirId || null,
    EncounterFhirId: mapped.encounterFhirId || null,
    PatientFhirId: mapped.patientFhirId || null,
    PatientName: mapped.patientName || null,
    SendingOrgFhirId: mapped.sendingOrgFhirId || null,
    SendingOrgName: mapped.sendingOrgName || null,
    ReceivingOrgFhirId: mapped.receivingOrgFhirId || null,
    ReceivingOrgName: mapped.receivingOrgName || null,
    SendingPracFhirId: mapped.sendingPracFhirId || null,
    SendingPracName: mapped.sendingPracName || null,
    ReceivingPracFhirId: mapped.receivingPracFhirId || null,
    ReceivingPracName: mapped.receivingPracName || null,
    CategoryCode: mapped.categoryCode || null,
    CategoryDisplay: mapped.categoryDisplay || null,
    CategoryText: mapped.categoryText || null,
    ReasonCode: mapped.reasonCode || null,
    ReasonDisplay: mapped.reasonDisplay || null,
    ReasonText: mapped.reasonText || null,
    ChiefComplaint: mapped.chiefComplaint || null,
    WorkingImpression: mapped.workingImpression || null,
    ClinicalHistory: mapped.clinicalHistory || null,
    TreatmentGiven: mapped.treatmentGiven || null,
    LabConclusion: mapped.labConclusion || null,
    ReferralNote: mapped.referralNote || null,
    TaskNote: mapped.taskNote || null,
    DateOfReferral: mapped.dateOfReferral || null,
  };

  if (existing) {
    db.prepare(`
      UPDATE Referrals SET
        TaskStatus = @TaskStatus,
        ServiceRequestFhirId = COALESCE(@ServiceRequestFhirId, ServiceRequestFhirId),
        EncounterFhirId = COALESCE(@EncounterFhirId, EncounterFhirId),
        PatientFhirId = COALESCE(@PatientFhirId, PatientFhirId),
        PatientName = COALESCE(@PatientName, PatientName),
        SendingOrgFhirId = COALESCE(@SendingOrgFhirId, SendingOrgFhirId),
        SendingOrgName = COALESCE(@SendingOrgName, SendingOrgName),
        ReceivingOrgFhirId = COALESCE(@ReceivingOrgFhirId, ReceivingOrgFhirId),
        ReceivingOrgName = COALESCE(@ReceivingOrgName, ReceivingOrgName),
        SendingPracFhirId = COALESCE(@SendingPracFhirId, SendingPracFhirId),
        SendingPracName = COALESCE(@SendingPracName, SendingPracName),
        ReceivingPracFhirId = COALESCE(@ReceivingPracFhirId, ReceivingPracFhirId),
        ReceivingPracName = COALESCE(@ReceivingPracName, ReceivingPracName),
        CategoryCode = COALESCE(@CategoryCode, CategoryCode),
        CategoryDisplay = COALESCE(@CategoryDisplay, CategoryDisplay),
        CategoryText = COALESCE(@CategoryText, CategoryText),
        ReasonCode = COALESCE(@ReasonCode, ReasonCode),
        ReasonDisplay = COALESCE(@ReasonDisplay, ReasonDisplay),
        ReasonText = COALESCE(@ReasonText, ReasonText),
        ChiefComplaint = COALESCE(@ChiefComplaint, ChiefComplaint),
        WorkingImpression = COALESCE(@WorkingImpression, WorkingImpression),
        ClinicalHistory = COALESCE(@ClinicalHistory, ClinicalHistory),
        TreatmentGiven = COALESCE(@TreatmentGiven, TreatmentGiven),
        LabConclusion = COALESCE(@LabConclusion, LabConclusion),
        ReferralNote = COALESCE(@ReferralNote, ReferralNote),
        TaskNote = COALESCE(@TaskNote, TaskNote),
        DateOfReferral = COALESCE(@DateOfReferral, DateOfReferral),
        Direction = CASE WHEN Direction = 'sent' THEN Direction ELSE 'received' END,
        SyncStatus = 'synced',
        SyncError = NULL,
        SyncedAt = datetime('now'),
        UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({ Id: existing.Id, ...fields });
    return {
      referral: mapReferral(db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(existing.Id)),
      created: false,
    };
  }

  const nextNum = db.prepare('SELECT COUNT(*) AS c FROM Referrals').get().c + 1;
  const localCode = `${TEAM_PREFIX}-IN${String(nextNum).padStart(4, '0')}`;
  let requisitionValue =
    mapped.requisitionValue || `${TEAM_PREFIX}-IN-REF-${Date.now().toString().slice(-8)}`;

  const insertSql = `
    INSERT INTO Referrals (
      LocalCode, RequisitionValue,
      PatientFhirId, PatientName,
      SendingOrgFhirId, SendingOrgName,
      ReceivingOrgFhirId, ReceivingOrgName,
      SendingPracFhirId, SendingPracName,
      ReceivingPracFhirId, ReceivingPracName,
      CategoryCode, CategoryDisplay, CategoryText,
      ReasonCode, ReasonDisplay, ReasonText,
      ChiefComplaint, WorkingImpression, ClinicalHistory, TreatmentGiven, LabConclusion,
      ReferralNote, TaskNote, DateOfReferral,
      ServiceRequestFhirId, TaskFhirId, EncounterFhirId,
      TaskStatus, Direction, SyncStatus, SyncedAt
    ) VALUES (
      @LocalCode, @RequisitionValue,
      @PatientFhirId, @PatientName,
      @SendingOrgFhirId, @SendingOrgName,
      @ReceivingOrgFhirId, @ReceivingOrgName,
      @SendingPracFhirId, @SendingPracName,
      @ReceivingPracFhirId, @ReceivingPracName,
      @CategoryCode, @CategoryDisplay, @CategoryText,
      @ReasonCode, @ReasonDisplay, @ReasonText,
      @ChiefComplaint, @WorkingImpression, @ClinicalHistory, @TreatmentGiven, @LabConclusion,
      @ReferralNote, @TaskNote, @DateOfReferral,
      @ServiceRequestFhirId, @TaskFhirId, @EncounterFhirId,
      @TaskStatus, 'received', 'synced', datetime('now')
    )
  `;

  try {
    const info = db.prepare(insertSql).run({
      LocalCode: localCode,
      RequisitionValue: requisitionValue,
      TaskFhirId: mapped.taskFhirId || null,
      ...fields,
    });
    return {
      referral: mapReferral(db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(info.lastInsertRowid)),
      created: true,
    };
  } catch (err) {
    if (!String(err.message || '').toLowerCase().includes('unique')) throw err;
    requisitionValue = `${requisitionValue}-IN`;
    const info = db.prepare(insertSql).run({
      LocalCode: `${localCode}-B`,
      RequisitionValue: requisitionValue,
      TaskFhirId: mapped.taskFhirId || null,
      ...fields,
    });
    return {
      referral: mapReferral(db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(info.lastInsertRowid)),
      created: true,
    };
  }
}

function isIncomingMatch(mapped, { q, receivingOrgFhirId }) {
  if (
    receivingOrgFhirId &&
    String(mapped.receivingOrgFhirId || '') !== receivingOrgFhirId
  ) {
    return false;
  }
  if (q) {
    const hay = Object.values(mapped)
      .filter((v) => typeof v === 'string')
      .join(' ')
      .toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  return true;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) || 0 }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function dedupeIncomingSummaries(list) {
  const byTask = new Map();
  for (const item of list || []) {
    const taskKey = item.taskFhirId || `tmp-${byTask.size}`;
    if (!byTask.has(taskKey)) byTask.set(taskKey, item);
  }

  // One row per ServiceRequest / requisition (keep newest Task).
  const byReferral = new Map();
  for (const item of byTask.values()) {
    const key =
      item.serviceRequestFhirId ||
      item.requisitionValue ||
      item.taskFhirId ||
      `row-${byReferral.size}`;
    const prev = byReferral.get(key);
    if (!prev) {
      byReferral.set(key, item);
      continue;
    }
    const prevTime = Date.parse(prev.dateOfReferral || prev.createdAt || '') || 0;
    const nextTime = Date.parse(item.dateOfReferral || item.createdAt || '') || 0;
    const prevId = Number(prev.taskFhirId) || 0;
    const nextId = Number(item.taskFhirId) || 0;
    if (nextTime > prevTime || (nextTime === prevTime && nextId >= prevId)) {
      byReferral.set(key, item);
    }
  }
  return [...byReferral.values()];
}

router.get('/', async (req, res) => {
  const status = req.query.status ? String(req.query.status).trim() : 'all';
  const q = req.query.q ? String(req.query.q).trim() : '';
  const receivingOrgFhirId = req.query.receivingOrgFhirId
    ? String(req.query.receivingOrgFhirId).trim()
    : '';
  // Page size for FHIR search; all=true walks every next-link page.
  const count = Math.min(200, Math.max(1, Number(req.query.count) || 100));

  try {
    const statusParam =
      status === 'all'
        ? 'requested,accepted,rejected,in-progress,received,on-hold,completed'
        : status;
    const { tasks, byRef } = await searchTasks({
      count,
      status: statusParam,
      all: true,
      maxPages: 50,
      includeRelated: true,
    });
    // Drop duplicate Task ids from paged FHIR bundles.
    const uniqueTasks = [];
    const seenTaskIds = new Set();
    for (const task of tasks) {
      const id = String(task?.id || '');
      if (id && seenTaskIds.has(id)) continue;
      if (id) seenTaskIds.add(id);
      uniqueTasks.push(task);
    }

    // List path: summarize from included bundle resources (no per-Task FHIR GETs).
    const mappedList = uniqueTasks.map((task) => {
      try {
        return summarizeIncomingTaskList(task, byRef);
      } catch (err) {
        return {
          taskFhirId: task?.id || null,
          taskStatus: task?.status || 'requested',
          serviceRequestFhirId: null,
          patientFhirId: null,
          patientName: 'Unknown patient',
          sendingOrgFhirId: null,
          sendingOrgName: null,
          receivingOrgFhirId: null,
          receivingOrgName: null,
          categoryText: null,
          requisitionValue: task?.id ? `TASK-${task.id}` : null,
          dateOfReferral: task?.authoredOn || task?.meta?.lastUpdated || null,
          enrichError: String(err.message || err).slice(0, 180),
        };
      }
    });

    const summaries = dedupeIncomingSummaries(
      mappedList
        .filter(Boolean)
        .filter((mapped) => isIncomingMatch(mapped, { q, receivingOrgFhirId }))
        .map((mapped) => {
          // Never ship nested FHIR resources to the browser list.
          const { _resources, ...summary } = mapped;
          return {
            ...summary,
            id: null,
            localCode: summary.localCode || summary.requisitionValue || null,
            direction: 'received',
            syncStatus: 'synced',
            source: 'fhir',
          };
        })
    ).sort((a, b) => {
      const tb = Date.parse(b.dateOfReferral || b.createdAt || '') || 0;
      const ta = Date.parse(a.dateOfReferral || a.createdAt || '') || 0;
      if (tb !== ta) return tb - ta;
      return String(b.taskFhirId || '').localeCompare(String(a.taskFhirId || ''));
    });

    return res.json({
      source: 'fhir',
      status,
      receivingOrgFhirId: receivingOrgFhirId || null,
      referrals: summaries,
      total: summaries.length,
      scanned: uniqueTasks.length,
      pageSize: count,
      paged: true,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/pull', async (req, res) => {
  // Local inbox pull temporarily disabled - Incoming loads live from FHIR.
  return res.status(503).json({
    error: 'Local inbox pull is temporarily disabled. Use Refresh from FHIR on Incoming.',
    disabled: true,
  });
});

router.get('/task/:taskId', async (req, res) => {
  try {
    const packageData = await loadIncomingReferralPackage(req.params.taskId);
    res.json({
      referral: { ...packageData.summary, source: 'fhir' },
      package: packageData,
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

/** Export related resources as Bundle.type=collection (download / handoff). */
router.get('/task/:taskId/collection', async (req, res) => {
  const taskId = String(req.params.taskId || '').trim();
  if (!taskId) return res.status(400).json({ error: 'Task FHIR ID is required.' });

  try {
    const { bundle, package: packageData } = await loadReferralCollectionBundle(taskId);
    const download = String(req.query.download || '').toLowerCase() === 'true';
    if (download) {
      const filename = `eref-collection-${taskId}.json`;
      res.setHeader('Content-Type', 'application/fhir+json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(JSON.stringify(bundle, null, 2));
    }
    res.json({
      ok: true,
      purpose: 'export-handoff',
      bundleType: 'collection',
      entryCount: bundle.entry?.length || 0,
      summary: packageData.summary,
      bundle,
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

/** Task status timeline from FHIR Bundle.type=history. */
router.get('/task/:taskId/history', async (req, res) => {
  const taskId = String(req.params.taskId || '').trim();
  if (!taskId) return res.status(400).json({ error: 'Task FHIR ID is required.' });

  try {
    const count = Math.min(100, Math.max(1, Number(req.query.count) || 50));
    const history = await fetchTaskHistory(taskId, { count });
    res.json({
      ok: true,
      purpose: 'status-timeline',
      bundleType: 'history',
      taskFhirId: taskId,
      total: history.total,
      timeline: history.timeline,
      bundle: history.bundle,
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.post('/task/:taskId/transfer', async (req, res) => {
  const taskId = String(req.params.taskId || '').trim();
  const b = req.body || {};
  if (!taskId) return res.status(400).json({ error: 'Task FHIR ID is required.' });

  try {
    const result = await transferIncomingReferral({
      taskFhirId: taskId,
      receivingOrgFhirId: b.receivingOrgFhirId,
      receivingPracRoleFhirId: b.receivingPracRoleFhirId || b.receivingPracFhirId,
      reason: b.reason || b.note,
      receivingOrgName: b.receivingOrgName,
      receivingPracName: b.receivingPracName,
    });

    logActivity({
      eventType: 'Referral',
      entityName: `Task/${taskId}`,
      actionText: 'Incoming referral transferred',
      syncStatus: 'synced',
      details: result.transferNote,
      entity: 'referral',
    });
    publishDashboard();

    res.json({
      ok: true,
      source: 'fhir',
      ...result,
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.post('/task/:taskId/status', async (req, res) => {
  const taskId = String(req.params.taskId || '').trim();
  const status = String(req.body?.status || '').toLowerCase();
  const allowed = new Set([
    'requested',
    'received',
    'accepted',
    'rejected',
    'in-progress',
    'on-hold',
    'completed',
    'cancelled',
  ]);
  if (!taskId) return res.status(400).json({ error: 'Task FHIR ID is required.' });
  if (!allowed.has(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${[...allowed].join(', ')}` });
  }

  try {
    await getTask(taskId);
    const note =
      req.body?.note ||
      (status === 'accepted'
        ? 'Referral accepted by receiving facility.'
        : status === 'rejected'
          ? 'Referral rejected by receiving facility.'
          : status === 'received'
            ? 'Referral marked as received.'
            : null);

    const fhirResult = await updateTaskStatus(taskId, status, note);

    // Local mirror skipped while persistent local DB is disabled.
    // try {
    //   db.prepare(`UPDATE Referrals SET TaskStatus = ... WHERE TaskFhirId = ?`).run(...)
    // } catch { }

    logActivity({
      eventType: 'Referral',
      entityName: `Task/${taskId}`,
      actionText: `Incoming Task marked ${status}`,
      syncStatus: 'synced',
      details: note || status,
      entity: 'referral',
    });
    publishDashboard();

    res.json({
      ok: true,
      taskFhirId: taskId,
      taskStatus: status,
      fhir: fhirResult || null,
      source: 'fhir',
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Incoming referral not found' });

    const referral = mapReferral(row);
    const hydrate = String(req.query.hydrate || 'true').toLowerCase() !== 'false';

    if (!hydrate || !row.TaskFhirId) {
      return res.json({ referral, package: null });
    }

    try {
      const packageData = await loadIncomingReferralPackage(row.TaskFhirId);
      // Keep local clinical text if package did not fill it.
      packageData.summary = {
        ...packageData.summary,
        chiefComplaint: packageData.summary.chiefComplaint || referral.chiefComplaint,
        workingImpression: packageData.summary.workingImpression || referral.workingImpression,
        clinicalHistory: packageData.summary.clinicalHistory || referral.clinicalHistory,
        treatmentGiven: packageData.summary.treatmentGiven || referral.treatmentGiven,
        labConclusion: packageData.summary.labConclusion || referral.labConclusion,
      };
      return res.json({ referral, package: packageData });
    } catch (hydrateErr) {
      return res.json({
        referral,
        package: null,
        warning: `Could not hydrate FHIR package: ${hydrateErr.message}`,
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/status', async (req, res) => {
  const status = String(req.body?.status || '').toLowerCase();
  const allowed = new Set([
    'requested',
    'received',
    'accepted',
    'rejected',
    'in-progress',
    'on-hold',
    'completed',
    'cancelled',
  ]);
  if (!allowed.has(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${[...allowed].join(', ')}` });
  }

  try {
    const row = db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Incoming referral not found' });
    if (!row.TaskFhirId) {
      return res.status(400).json({ error: 'Referral has no Task FHIR ID to update.' });
    }

    // Ensure Task still exists before write.
    await getTask(row.TaskFhirId);

    const note =
      req.body?.note ||
      (status === 'accepted'
        ? 'Referral accepted by receiving facility.'
        : status === 'rejected'
          ? 'Referral rejected by receiving facility.'
          : status === 'received'
            ? 'Referral marked as received.'
            : null);

    const fhirResult = await updateTaskStatus(row.TaskFhirId, status, note);
    db.prepare(`
      UPDATE Referrals
      SET TaskStatus = @TaskStatus,
          TaskNote = COALESCE(@TaskNote, TaskNote),
          SyncStatus = 'synced',
          SyncError = NULL,
          SyncedAt = datetime('now'),
          UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({
      Id: row.Id,
      TaskStatus: status,
      TaskNote: note,
    });

    const updated = db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(row.Id);
    logActivity({
      eventType: 'Referral',
      entityName: `${updated.LocalCode} - ${updated.PatientName || 'patient'}`,
      actionText: `Incoming Task status → ${status}`,
      syncStatus: 'synced',
      details: `Task ${updated.TaskFhirId}`,
      entity: 'referral',
    });

    res.json({
      referral: mapReferral(updated),
      fhir: { id: fhirResult.fhirId, status: fhirResult.status },
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

module.exports = router;
