const express = require('express');
const crypto = require('crypto');
const { db } = require('./db');
const {
  putPatient,
  putOrganization,
  putPractitioner,
  putPractitionerRole,
  buildReferralBundle,
  submitReferralBundle,
  searchTasks,
  updateTaskStatus,
  enrichIncomingTask,
  getOrganization,
  getPractitioner,
  getPractitionerRole,
  getPatient,
  DEFAULT_ROLE_CODE,
  DEFAULT_ROLE_DISPLAY,
  REQUISITION_SYSTEM,
} = require('./fhir');
const { logActivity, publishDashboard } = require('./activity');

const router = express.Router();
const TEAM_PREFIX = process.env.TEAM_PREFIX || 'TEAM07';

const SERVICE_REQUEST_PROFILE =
  'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-service-request';
const TASK_PROFILE = 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-task';
const SNOMED_SYSTEM = 'http://snomed.info/sct';

const CATEGORY_OPTIONS = [
  {
    code: '73770003',
    display: 'Emergency',
    text: 'Emergency',
  },
  {
    code: '440655000',
    display: 'Outpatient',
    text: 'Outpatient',
  },
];

const REASON_OPTIONS = [
  { code: '71388002', display: 'Procedure', text: 'Procedure / intervention' },
  { code: '11429006', display: 'Consultation', text: 'Consultation' },
  { code: '165197003', display: 'Diagnostics', text: 'Diagnostics' },
  { code: '3457005', display: 'Others', text: 'General referral' },
];

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
    workingImpressionCode: row.WorkingImpressionCode,
    workingImpressionDisplay: row.WorkingImpressionDisplay,
    linkedConditionFhirId: row.LinkedConditionFhirId,
    linkedDiagnosisText: row.LinkedDiagnosisText,
    clinicalHistory: row.ClinicalHistory,
    treatmentGiven: row.TreatmentGiven,
    bpSystolic: row.BpSystolic,
    bpDiastolic: row.BpDiastolic,
    heartRate: row.HeartRate,
    respiratoryRate: row.RespiratoryRate,
    oxygenSaturation: row.OxygenSaturation,
    temperature: row.Temperature,
    weight: row.Weight,
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

function pracDisplay(row) {
  if (!row) return null;
  const prefix = row.Prefix ? `${row.Prefix} ` : '';
  return `${prefix}${row.GivenName} ${row.FamilyName}`.trim();
}

function patientDisplay(row) {
  if (!row) return null;
  return `${row.GivenName1} ${row.FamilyName}`.trim();
}

function resolveCategory(b) {
  const hit =
    CATEGORY_OPTIONS.find((c) => c.code === b.categoryCode) ||
    CATEGORY_OPTIONS.find((c) => c.text.toLowerCase() === String(b.categoryText || '').toLowerCase()) ||
    CATEGORY_OPTIONS[0];
  return {
    code: b.categoryCode || hit.code,
    display: b.categoryDisplay || hit.display,
    text: b.categoryText || hit.text,
  };
}

function resolveReason(b) {
  const hit =
    REASON_OPTIONS.find((r) => r.code === b.reasonCode) || REASON_OPTIONS[0];
  return {
    code: b.reasonCode || hit.code,
    display: b.reasonDisplay || hit.display,
    text: b.reasonText || hit.text,
  };
}

function lookupOrgByFhirId(fhirId) {
  if (!fhirId) return null;
  return db.prepare('SELECT * FROM Organizations WHERE FhirId = ?').get(String(fhirId)) || null;
}

function selectLabel(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

/** Draft preview Bundle (ServiceRequest + Task) - works with empty/partial form data. */
function buildDraftPreviewBundle(b = {}) {
  const rawNow = b.dateOfReferral ? new Date(b.dateOfReferral) : new Date();
  const nowDate = Number.isNaN(rawNow.getTime()) ? new Date() : rawNow;
  // Match connectathon preview style: minute precision.
  nowDate.setSeconds(0, 0);
  const now = nowDate.toISOString();
  const year = nowDate.getUTCFullYear();
  const stamp = String(Date.now()).slice(-6);
  const requisitionValue = b.requisitionValue || `REF-${year}-${stamp}`;
  const category = resolveCategory(b);

  let patient = null;
  if (b.patientId) {
    patient = db.prepare('SELECT * FROM Patients WHERE Id = ?').get(Number(b.patientId)) || null;
  }
  const patientFhirId = String(
    b.patientFhirId || patient?.FhirId || patient?.fhirId || ''
  ).trim();
  const patientNameRaw = selectLabel(b.patientName || patientDisplay(patient), '');
  const patientDisplayName = patientNameRaw ? patientNameRaw : 'Patient ';

  let sendingOrgFhirId = String(b.sendingOrgFhirId || '').trim();
  let receivingOrgFhirId = String(b.receivingOrgFhirId || '').trim();
  // Fill org refs from practitioner roles when facility selects are empty.
  if (!sendingOrgFhirId && b.sendingRoleOrganizationFhirId) {
    sendingOrgFhirId = String(b.sendingRoleOrganizationFhirId).trim();
  }
  if (!receivingOrgFhirId && b.receivingRoleOrganizationFhirId) {
    receivingOrgFhirId = String(b.receivingRoleOrganizationFhirId).trim();
  }

  const sendingOrgRow = lookupOrgByFhirId(sendingOrgFhirId);
  const receivingOrgRow = lookupOrgByFhirId(receivingOrgFhirId);
  const sendingOrgName = selectLabel(b.sendingOrgName || sendingOrgRow?.Name, '');
  const receivingOrgName = selectLabel(b.receivingOrgName || receivingOrgRow?.Name, '');

  const sendingRoleFhirId = String(
    b.sendingPracRoleFhirId || b.sendingPracFhirId || ''
  ).trim();
  const receivingRoleFhirId = String(
    b.receivingPracRoleFhirId || b.receivingPracFhirId || ''
  ).trim();

  const sendingRoleDisplay = selectLabel(
    b.sendingPracRoleDisplay,
    sendingRoleFhirId
      ? `PractitionerRole/${sendingRoleFhirId}${
          sendingOrgName ? ` - ${sendingOrgName}` : ''
        }`
      : ''
  );
  const receivingRoleDisplay = selectLabel(
    b.receivingPracRoleDisplay,
    receivingRoleFhirId
      ? `PractitionerRole/${receivingRoleFhirId}${
          receivingOrgName ? ` - ${receivingOrgName}` : ''
        }`
      : ''
  );

  const srUrl = `urn:uuid:${crypto.randomUUID()}`;
  const taskUrl = `urn:uuid:${crypto.randomUUID()}`;

  const categoryDisplay = category.text || category.display || 'Outpatient';

  const serviceRequest = {
    resourceType: 'ServiceRequest',
    meta: { profile: [SERVICE_REQUEST_PROFILE] },
    requisition: {
      system: REQUISITION_SYSTEM,
      value: requisitionValue,
    },
    status: 'active',
    intent: 'order',
    priority: 'routine',
    category: [
      {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: category.code,
            display: categoryDisplay,
          },
        ],
        text: categoryDisplay,
      },
    ],
    subject: {
      reference: `Patient/${patientFhirId}`,
      display: patientDisplayName,
    },
    occurrenceDateTime: now,
    authoredOn: now,
    requester: {
      reference: `PractitionerRole/${sendingRoleFhirId}`,
      display: sendingRoleDisplay || undefined,
    },
    performer: [
      {
        reference: `PractitionerRole/${receivingRoleFhirId}`,
        display: receivingRoleDisplay || undefined,
      },
    ],
    code: {
      text: b.codeText || 'General Medical Referral',
    },
  };

  if (!serviceRequest.requester.display) delete serviceRequest.requester.display;
  if (!serviceRequest.performer[0].display) delete serviceRequest.performer[0].display;

  if (b.reasonText) {
    const reason = resolveReason(b);
    serviceRequest.reasonCode = [
      {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: reason.code,
            display: reason.display,
          },
        ],
        text: b.reasonText,
      },
    ];
  }
  if (b.referralNote) {
    serviceRequest.note = [{ text: String(b.referralNote) }];
  }

  const task = {
    resourceType: 'Task',
    meta: { profile: [TASK_PROFILE] },
    status: 'requested',
    intent: 'order',
    priority: 'routine',
    code: {
      coding: [
        {
          system: SNOMED_SYSTEM,
          code: '3457005',
          display: 'Patient referral',
        },
      ],
    },
    focus: { reference: srUrl },
    for: { reference: `Patient/${patientFhirId}` },
    requester: {
      reference: `Organization/${sendingOrgFhirId}`,
    },
    owner: {
      reference: `Organization/${receivingOrgFhirId}`,
    },
    authoredOn: now,
  };

  if (b.taskNote) {
    task.note = [{ text: String(b.taskNote) }];
  }

  const bundle = {
    resourceType: 'Bundle',
    id: `ERefBundle-${requisitionValue}`,
    type: 'transaction',
    timestamp: new Date().toISOString(),
    entry: [
      {
        fullUrl: srUrl,
        resource: serviceRequest,
        request: { method: 'POST', url: 'ServiceRequest' },
      },
      {
        fullUrl: taskUrl,
        resource: task,
        request: { method: 'POST', url: 'Task' },
      },
    ],
  };

  return {
    bundle,
    labAttachment: null,
    requisitionValue,
    patientName: patientNameRaw || null,
    sendingOrgName: sendingOrgName || null,
    receivingOrgName: receivingOrgName || null,
    entryCount: 2,
    resourceTypes: ['ServiceRequest', 'Task'],
  };
}

async function ensurePatientSynced(row) {
  if (row.FhirId && (row.SyncStatus === 'synced' || !row.Id)) return row;
  const result = await putPatient(row);
  if (!row.Id) {
    return {
      ...row,
      FhirId: result.fhirId,
      SyncStatus: 'synced',
    };
  }
  db.prepare(`
    UPDATE Patients
    SET FhirId = @FhirId,
        SyncStatus = 'synced',
        SyncError = NULL,
        SyncedAt = datetime('now'),
        UpdatedAt = datetime('now')
    WHERE Id = @Id
  `).run({ Id: row.Id, FhirId: result.fhirId });
  return db.prepare('SELECT * FROM Patients WHERE Id = ?').get(row.Id);
}

function patientRowFromMapped(mapped) {
  if (!mapped) return null;
  return {
    Id: mapped.id || null,
    LocalCode: mapped.localCode || '-',
    PhilSysId: mapped.philsysId || '-',
    PhilHealthId: mapped.philhealthId || null,
    FamilyName: mapped.familyName || '-',
    GivenName1: mapped.givenName1 || '',
    GivenName2: mapped.givenName2 || null,
    Gender: mapped.gender || null,
    BirthDate: mapped.birthDate || null,
    Phone: mapped.phone || null,
    AddressLine: mapped.addressLine || null,
    RegionCode: mapped.regionCode || null,
    RegionDisplay: mapped.regionDisplay || null,
    ProvinceCode: mapped.provinceCode || null,
    ProvinceDisplay: mapped.provinceDisplay || null,
    CityCode: mapped.cityCode || null,
    CityDisplay: mapped.cityDisplay || null,
    BarangayCode: mapped.barangayCode || null,
    BarangayDisplay: mapped.barangayDisplay || null,
    PostalCode: mapped.postalCode || null,
    FhirId: mapped.fhirId || null,
    SyncStatus: mapped.syncStatus || 'synced',
  };
}

async function resolvePatientRef({ patientId, patientFhirId }) {
  if (patientId) {
    const local = db.prepare('SELECT * FROM Patients WHERE Id = ?').get(Number(patientId));
    if (local) return ensurePatientSynced(local);
  }

  const fhirId = patientFhirId ? String(patientFhirId).trim() : '';
  if (fhirId) {
    const localByFhir = db.prepare('SELECT * FROM Patients WHERE FhirId = ?').get(fhirId);
    if (localByFhir) return ensurePatientSynced(localByFhir);
    const mapped = await getPatient(fhirId);
    const row = patientRowFromMapped(mapped);
    if (!row?.FhirId) {
      throw Object.assign(new Error(`Patient not found on FHIR (id ${fhirId}).`), { status: 400 });
    }
    return row;
  }

  throw Object.assign(new Error('Missing patient (local id or FHIR id).'), { status: 400 });
}

async function ensureOrganizationSynced(row) {
  if (row.FhirId && row.SyncStatus === 'synced') return row;
  const result = await putOrganization(row);
  db.prepare(`
    UPDATE Organizations
    SET FhirId = @FhirId,
        SyncStatus = 'synced',
        SyncError = NULL,
        SyncedAt = datetime('now'),
        UpdatedAt = datetime('now')
    WHERE Id = @Id
  `).run({ Id: row.Id, FhirId: result.fhirId });
  return db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(row.Id);
}

async function ensurePractitionerSynced(row, organizationFhirId) {
  // FHIR-only PractitionerRole selection (no local SQLite id).
  if (!row?.Id) {
    return {
      ...row,
      OrganizationFhirId: organizationFhirId || row.OrganizationFhirId || null,
      RoleCode: row.RoleCode || row.roleCode || DEFAULT_ROLE_CODE,
      RoleDisplay: row.RoleDisplay || row.roleDisplay || DEFAULT_ROLE_DISPLAY,
      FhirId: row.FhirId || row.fhirId || row.practitionerFhirId || null,
      PrcId: row.PrcId || row.prcId || null,
      FamilyName: row.FamilyName || row.familyName || 'Practitioner',
      GivenName: row.GivenName || row.givenName || row.roleDisplay || 'Unknown',
      Prefix: row.Prefix || row.prefix || null,
      RoleFhirId: row.RoleFhirId || row.roleFhirId || null,
      SyncStatus: 'synced',
    };
  }

  let current = row;
  if (!(current.FhirId && current.SyncStatus === 'synced')) {
    const result = await putPractitioner(current);
    db.prepare(`
      UPDATE Practitioners
      SET FhirId = @FhirId,
          SyncStatus = 'synced',
          SyncError = NULL,
          SyncedAt = datetime('now'),
          UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({ Id: current.Id, FhirId: result.fhirId });
    current = db.prepare('SELECT * FROM Practitioners WHERE Id = ?').get(current.Id);
  }

  const orgFhirId = organizationFhirId || current.OrganizationFhirId;
  if (orgFhirId && current.FhirId) {
    try {
      const roleResult = await putPractitionerRole({
        ...current,
        OrganizationFhirId: orgFhirId,
        RoleCode: current.RoleCode || DEFAULT_ROLE_CODE,
        RoleDisplay: current.RoleDisplay || DEFAULT_ROLE_DISPLAY,
      });
      db.prepare(`
        UPDATE Practitioners
        SET RoleFhirId = @RoleFhirId,
            OrganizationFhirId = @OrganizationFhirId,
            RoleCode = COALESCE(RoleCode, @RoleCode),
            RoleDisplay = COALESCE(RoleDisplay, @RoleDisplay),
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({
        Id: current.Id,
        RoleFhirId: roleResult.fhirId,
        OrganizationFhirId: orgFhirId,
        RoleCode: DEFAULT_ROLE_CODE,
        RoleDisplay: DEFAULT_ROLE_DISPLAY,
      });
      current = db.prepare('SELECT * FROM Practitioners WHERE Id = ?').get(current.Id);
    } catch {
      // PractitionerRole sync is best-effort; Bundle will still PUT roles.
    }
  }

  return current;
}

function pracFromRoleApi(role, practitioner) {
  if (!role && !practitioner) return null;
  const given =
    practitioner?.givenName ||
    role?.givenName ||
    (role?.practitionerName ? String(role.practitionerName).split(/\s+/)[0] : '') ||
    'Unknown';
  const family =
    practitioner?.familyName ||
    role?.familyName ||
    (role?.practitionerName
      ? String(role.practitionerName).split(/\s+/).slice(1).join(' ')
      : '') ||
    'Practitioner';
  return {
    Id: null,
    PrcId: role?.prcId && role.prcId !== '-' ? role.prcId : practitioner?.prcId || null,
    FamilyName: family || 'Practitioner',
    GivenName: given || 'Unknown',
    Prefix: practitioner?.prefix || role?.prefix || null,
    RoleCode: role?.roleCode || DEFAULT_ROLE_CODE,
    RoleDisplay: role?.roleDisplay || DEFAULT_ROLE_DISPLAY,
    RoleFhirId: role?.fhirId || null,
    OrganizationFhirId: role?.organizationFhirId || null,
    FhirId: role?.practitionerFhirId || practitioner?.fhirId || null,
    SyncStatus: 'synced',
  };
}

async function resolvePractitionerRef({
  pracId,
  roleFhirId,
  pracFhirId,
  label,
  organizationFhirId,
  optional = false,
}) {
  if (pracId) {
    const local = db.prepare('SELECT * FROM Practitioners WHERE Id = ?').get(Number(pracId));
    if (local) return ensurePractitionerSynced(local, organizationFhirId);
  }

  const roleId = roleFhirId ? String(roleFhirId).trim() : '';
  if (roleId) {
    const localByRole = db
      .prepare('SELECT * FROM Practitioners WHERE RoleFhirId = ?')
      .get(roleId);
    if (localByRole) return ensurePractitionerSynced(localByRole, organizationFhirId);

    const role = await getPractitionerRole(roleId);
    let practitioner = null;
    if (role?.practitionerFhirId) {
      try {
        practitioner = await getPractitioner(role.practitionerFhirId);
      } catch {
        practitioner = null;
      }
    }
    const mapped = pracFromRoleApi(role, practitioner);
    if (!mapped?.FhirId && !mapped?.RoleFhirId) {
      if (optional) return null;
      throw new Error(`${label} practitioner role not found on FHIR (id ${roleId}).`);
    }
    if (organizationFhirId) mapped.OrganizationFhirId = organizationFhirId;
    return mapped;
  }

  const fhirId = pracFhirId ? String(pracFhirId).trim() : '';
  if (fhirId) {
    const localByFhir = db.prepare('SELECT * FROM Practitioners WHERE FhirId = ?').get(fhirId);
    if (localByFhir) return ensurePractitionerSynced(localByFhir, organizationFhirId);
    const practitioner = await getPractitioner(fhirId);
    const mapped = pracFromRoleApi(null, practitioner);
    if (!mapped?.FhirId) {
      if (optional) return null;
      throw new Error(`${label} practitioner not found on FHIR (id ${fhirId}).`);
    }
    if (organizationFhirId) mapped.OrganizationFhirId = organizationFhirId;
    return mapped;
  }

  if (optional) return null;
  throw new Error(`${label} practitioner is required.`);
}

function orgFromFhirApi(org) {
  if (!org) return null;
  return {
    Id: org.id || null,
    Name: org.name || '-',
    NhfrCode: org.nhfrCode || null,
    HcpnCode: org.hcpnCode || null,
    Phone: org.phone || null,
    AddressLine: org.addressLine || null,
    RegionCode: org.regionCode || null,
    RegionDisplay: org.regionDisplay || null,
    ProvinceCode: org.provinceCode || null,
    ProvinceDisplay: org.provinceDisplay || null,
    CityCode: org.cityCode || null,
    CityDisplay: org.cityDisplay || null,
    BarangayCode: org.barangayCode || null,
    BarangayDisplay: org.barangayDisplay || null,
    PostalCode: org.postalCode || null,
    FhirId: org.fhirId || null,
    SyncStatus: 'synced',
  };
}

async function resolveOrganizationRef({ orgId, orgFhirId, label }) {
  if (orgId) {
    const local = db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(Number(orgId));
    if (local) return ensureOrganizationSynced(local);
  }

  const fhirId = orgFhirId ? String(orgFhirId).trim() : '';
  if (fhirId) {
    const localByFhir = db
      .prepare('SELECT * FROM Organizations WHERE FhirId = ?')
      .get(fhirId);
    if (localByFhir) return ensureOrganizationSynced(localByFhir);

    const remote = await getOrganization(fhirId);
    const mapped = orgFromFhirApi(remote);
    if (!mapped?.FhirId) {
      throw new Error(`${label} facility not found on FHIR (id ${fhirId}).`);
    }
    return mapped;
  }

  throw new Error(`${label} facility is required.`);
}

function localOrgFhirIds() {
  return db
    .prepare(
      `SELECT FhirId FROM Organizations WHERE FhirId IS NOT NULL AND TRIM(FhirId) != ''`
    )
    .all()
    .map((r) => String(r.FhirId));
}

function isInboxRow(row, orgFhirIds = localOrgFhirIds()) {
  if (!row) return false;
  if (String(row.Direction || '').toLowerCase() === 'received') return true;
  if (orgFhirIds.length && row.ReceivingOrgFhirId && orgFhirIds.includes(String(row.ReceivingOrgFhirId))) {
    return true;
  }
  return false;
}

function listInboxRows() {
  const orgIds = localOrgFhirIds();
  return db
    .prepare(`SELECT * FROM Referrals ORDER BY datetime(COALESCE(DateOfReferral, CreatedAt)) DESC`)
    .all()
    .filter((row) => isInboxRow(row, orgIds));
}

function upsertIncomingReferral(mapped) {
  const existing = mapped.taskFhirId
    ? db.prepare('SELECT * FROM Referrals WHERE TaskFhirId = ?').get(mapped.taskFhirId)
    : null;

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
        ReferralNote = COALESCE(@ReferralNote, ReferralNote),
        TaskNote = COALESCE(@TaskNote, TaskNote),
        DateOfReferral = COALESCE(@DateOfReferral, DateOfReferral),
        SyncStatus = 'synced',
        SyncError = NULL,
        SyncedAt = datetime('now'),
        UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({
      Id: existing.Id,
      TaskStatus: mapped.taskStatus || existing.TaskStatus,
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
      ReferralNote: mapped.referralNote || null,
      TaskNote: mapped.taskNote || null,
      DateOfReferral: mapped.dateOfReferral || null,
    });
    return {
      referral: mapReferral(db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(existing.Id)),
      created: false,
    };
  }

  const nextNum = db.prepare('SELECT COUNT(*) AS c FROM Referrals').get().c + 1;
  const localCode = `${TEAM_PREFIX}-IN${String(nextNum).padStart(4, '0')}`;
  let requisitionValue = mapped.requisitionValue || `${TEAM_PREFIX}-IN-REF-${Date.now().toString().slice(-8)}`;

  const insert = db.prepare(`
    INSERT INTO Referrals (
      LocalCode, RequisitionValue,
      PatientFhirId, PatientName,
      SendingOrgFhirId, SendingOrgName,
      ReceivingOrgFhirId, ReceivingOrgName,
      SendingPracFhirId, SendingPracName,
      ReceivingPracFhirId, ReceivingPracName,
      CategoryCode, CategoryDisplay, CategoryText,
      ReasonCode, ReasonDisplay, ReasonText,
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
      @ReferralNote, @TaskNote, @DateOfReferral,
      @ServiceRequestFhirId, @TaskFhirId, @EncounterFhirId,
      @TaskStatus, 'received', 'synced', datetime('now')
    )
  `);

  try {
    const info = insert.run({
      LocalCode: localCode,
      RequisitionValue: requisitionValue,
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
      ReferralNote: mapped.referralNote || null,
      TaskNote: mapped.taskNote || null,
      DateOfReferral: mapped.dateOfReferral || null,
      ServiceRequestFhirId: mapped.serviceRequestFhirId || null,
      TaskFhirId: mapped.taskFhirId || null,
      EncounterFhirId: mapped.encounterFhirId || null,
      TaskStatus: mapped.taskStatus || 'requested',
    });
    return {
      referral: mapReferral(db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(info.lastInsertRowid)),
      created: true,
    };
  } catch (err) {
    if (!String(err.message || '').toLowerCase().includes('unique')) throw err;
    // Requisition collision with a sent row: attach Task IDs onto that row if missing, else use IN suffix.
    const byReq = db
      .prepare('SELECT * FROM Referrals WHERE RequisitionValue = ?')
      .get(requisitionValue);
    if (byReq && !byReq.TaskFhirId && mapped.taskFhirId) {
      db.prepare(`
        UPDATE Referrals SET
          TaskFhirId = @TaskFhirId,
          ServiceRequestFhirId = COALESCE(@ServiceRequestFhirId, ServiceRequestFhirId),
          TaskStatus = @TaskStatus,
          SyncStatus = 'synced',
          SyncedAt = datetime('now'),
          UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({
        Id: byReq.Id,
        TaskFhirId: mapped.taskFhirId,
        ServiceRequestFhirId: mapped.serviceRequestFhirId || null,
        TaskStatus: mapped.taskStatus || byReq.TaskStatus,
      });
      return {
        referral: mapReferral(db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(byReq.Id)),
        created: false,
      };
    }
    requisitionValue = `${requisitionValue}-IN`;
    const info = insert.run({
      LocalCode: `${localCode}-B`,
      RequisitionValue: requisitionValue,
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
      ReferralNote: mapped.referralNote || null,
      TaskNote: mapped.taskNote || null,
      DateOfReferral: mapped.dateOfReferral || null,
      ServiceRequestFhirId: mapped.serviceRequestFhirId || null,
      TaskFhirId: mapped.taskFhirId || null,
      EncounterFhirId: mapped.encounterFhirId || null,
      TaskStatus: mapped.taskStatus || 'requested',
    });
    return {
      referral: mapReferral(db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(info.lastInsertRowid)),
      created: true,
    };
  }
}

router.get('/options', (_req, res) => {
  res.json({
    categories: CATEGORY_OPTIONS,
    reasons: REASON_OPTIONS,
    practitionerRole: {
      code: DEFAULT_ROLE_CODE,
      display: DEFAULT_ROLE_DISPLAY,
    },
    taskStatuses: ['requested', 'received', 'accepted', 'rejected', 'in-progress', 'on-hold', 'completed'],
  });
});

router.get('/', (req, res) => {
  try {
    const direction = String(req.query.direction || 'sent').toLowerCase();
    const q = String(req.query.q || '').trim();
    let rows;

    if (direction === 'inbox' || direction === 'received') {
      rows = listInboxRows();
    } else if (direction === 'all') {
      rows = db
        .prepare(`SELECT * FROM Referrals ORDER BY datetime(COALESCE(DateOfReferral, CreatedAt)) DESC`)
        .all();
    } else {
      rows = db
        .prepare(
          `
        SELECT * FROM Referrals
        WHERE Direction = ?
        ORDER BY datetime(COALESCE(DateOfReferral, CreatedAt)) DESC
      `
        )
        .all(direction);
    }

    if (q) {
      const needle = q.toLowerCase();
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
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle)
      );
    }

    res.json({
      source: 'local',
      direction,
      referrals: rows.map(mapReferral),
      total: rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pull', async (req, res) => {
  try {
    const count = Math.min(100, Math.max(1, Number(req.body?.count) || 40));
    const status =
      req.body?.status ||
      'requested,accepted,rejected,in-progress,received,on-hold,completed';
    const orgIds = localOrgFhirIds();
    const tasks = await searchTasks({ count, status });

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const referrals = [];

    for (const task of tasks) {
      try {
        const mapped = await enrichIncomingTask(task);
        if (!mapped.taskFhirId) {
          skipped += 1;
          continue;
        }

        // Prefer referrals owned by one of our facilities when we have local orgs.
        if (
          orgIds.length &&
          mapped.receivingOrgFhirId &&
          !orgIds.includes(String(mapped.receivingOrgFhirId))
        ) {
          skipped += 1;
          continue;
        }

        const result = upsertIncomingReferral(mapped);
        if (result.created) created += 1;
        else updated += 1;
        referrals.push(result.referral);
      } catch {
        skipped += 1;
      }
    }

    logActivity({
      eventType: 'Referral',
      entityName: 'Inbox pull',
      actionText: 'Pulled incoming referrals from FHIR',
      syncStatus: 'synced',
      details: `created=${created}, updated=${updated}, skipped=${skipped}, scanned=${tasks.length}`,
      entity: 'referral',
    });
    publishDashboard();

    res.json({
      scanned: tasks.length,
      created,
      updated,
      skipped,
      filteredByLocalOrgs: orgIds.length > 0,
      referrals,
      inbox: listInboxRows().map(mapReferral),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
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
    if (!row) return res.status(404).json({ error: 'Referral not found' });
    if (!row.TaskFhirId) {
      return res.status(400).json({ error: 'Referral has no Task FHIR ID to update.' });
    }

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
      actionText: `Task status → ${status}`,
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

router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Referral not found' });
    res.json(mapReferral(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function partiesForStoredReferral(row) {
  let patient = row.PatientId
    ? db.prepare('SELECT * FROM Patients WHERE Id = ?').get(row.PatientId)
    : null;
  if (!patient) {
    throw Object.assign(new Error('Patient record missing locally for this referral.'), {
      status: 400,
    });
  }

  const sendingOrg = await resolveOrganizationRef({
    orgId: row.SendingOrgId,
    orgFhirId: row.SendingOrgFhirId,
    label: 'Sending',
  });
  const receivingOrg = await resolveOrganizationRef({
    orgId: row.ReceivingOrgId,
    orgFhirId: row.ReceivingOrgFhirId,
    label: 'Receiving',
  });

  const sendingPrac = await resolvePractitionerRef({
    pracId: row.SendingPracId,
    pracFhirId: row.SendingPracFhirId,
    label: 'Sending',
    organizationFhirId: sendingOrg.FhirId,
    optional: true,
  });
  const receivingPrac = await resolvePractitionerRef({
    pracId: row.ReceivingPracId,
    pracFhirId: row.ReceivingPracFhirId,
    label: 'Receiving',
    organizationFhirId: receivingOrg.FhirId,
    optional: true,
  });

  patient = await ensurePatientSynced(patient);
  const syncedSendingPrac = sendingPrac
    ? await ensurePractitionerSynced(sendingPrac, sendingOrg.FhirId)
    : null;
  const syncedReceivingPrac = receivingPrac
    ? await ensurePractitionerSynced(receivingPrac, receivingOrg.FhirId)
    : null;

  if (!patient.FhirId || !sendingOrg.FhirId || !receivingOrg.FhirId) {
    throw Object.assign(
      new Error(
        'Could not sync patient/facilities to FHIR. Ensure those records sync successfully first.'
      ),
      { status: 502 }
    );
  }

  return {
    patient,
    sendingOrg,
    receivingOrg,
    sendingPrac: syncedSendingPrac,
    receivingPrac: syncedReceivingPrac,
  };
}

function buildBundleFromReferralRow(row, parties) {
  const { patient, sendingOrg, receivingOrg, sendingPrac, receivingPrac } = parties;
  return buildReferralBundle({
    patient,
    sendingOrg,
    receivingOrg,
    sendingPrac,
    receivingPrac,
    data: {
      requisitionValue: row.RequisitionValue,
      dateOfReferral: row.DateOfReferral,
      patientName: row.PatientName || patientDisplay(patient),
      categoryCode: row.CategoryCode,
      categoryDisplay: row.CategoryDisplay,
      categoryText: row.CategoryText,
      reasonCode: row.ReasonCode,
      reasonDisplay: row.ReasonDisplay,
      reasonText: row.ReasonText,
      chiefComplaint: row.ChiefComplaint,
      workingImpression: row.WorkingImpression,
      workingImpressionCode: row.WorkingImpressionCode,
      workingImpressionDisplay: row.WorkingImpressionDisplay,
      linkedConditionFhirId: row.LinkedConditionFhirId,
      clinicalHistory: row.ClinicalHistory,
      treatmentGiven: row.TreatmentGiven,
      bpSystolic: row.BpSystolic,
      bpDiastolic: row.BpDiastolic,
      heartRate: row.HeartRate,
      respiratoryRate: row.RespiratoryRate,
      oxygenSaturation: row.OxygenSaturation,
      temperature: row.Temperature,
      weight: row.Weight,
      labConclusion: row.LabConclusion,
      referralNote: row.ReferralNote,
      taskNote: row.TaskNote,
      practitionerRoleCode: sendingPrac?.RoleCode || DEFAULT_ROLE_CODE,
      practitionerRoleDisplay: sendingPrac?.RoleDisplay || DEFAULT_ROLE_DISPLAY,
    },
  });
}

function markReferralSynced(rowId, mapped) {
  db.prepare(`
    UPDATE Referrals
    SET ServiceRequestFhirId = @ServiceRequestFhirId,
        TaskFhirId = @TaskFhirId,
        EncounterFhirId = @EncounterFhirId,
        SyncStatus = 'synced',
        SyncError = NULL,
        SyncedAt = datetime('now'),
        UpdatedAt = datetime('now')
    WHERE Id = @Id
  `).run({
    Id: rowId,
    ServiceRequestFhirId: mapped.serviceRequestId,
    TaskFhirId: mapped.taskId,
    EncounterFhirId: mapped.encounterId,
  });
  return db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(rowId);
}

function markReferralFailed(rowId, message) {
  db.prepare(`
    UPDATE Referrals
    SET SyncStatus = 'failed',
        SyncError = @SyncError,
        UpdatedAt = datetime('now')
    WHERE Id = @Id
  `).run({ Id: rowId, SyncError: String(message || 'FHIR sync failed').slice(0, 900) });
  return db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(rowId);
}

router.post('/:id/sync', async (req, res) => {
  try {
    let row = db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Referral not found' });
    if (String(row.Direction || '').toLowerCase() !== 'sent') {
      return res.status(400).json({ error: 'Only outbound (sent) referrals can be re-synced.' });
    }
    if (row.SyncStatus === 'synced' && row.ServiceRequestFhirId) {
      return res.json({
        referral: mapReferral(row),
        fhir: {
          status: 'already-synced',
          serviceRequestId: row.ServiceRequestFhirId,
          taskId: row.TaskFhirId,
          encounterId: row.EncounterFhirId,
        },
      });
    }

    const entityName = `${row.LocalCode} - ${row.PatientName}`;
    db.prepare(`
      UPDATE Referrals
      SET SyncStatus = 'pending',
          SyncError = NULL,
          UpdatedAt = datetime('now')
      WHERE Id = ?
    `).run(row.Id);

    const parties = await partiesForStoredReferral(row);
    const bundle = buildBundleFromReferralRow(row, parties);
    const fhirResult = await submitReferralBundle(bundle);
    const mapped = fhirResult.mapped || {};
    row = markReferralSynced(row.Id, mapped);

    logActivity({
      eventType: 'Referral',
      entityName,
      actionText: 'Referral re-synced',
      syncStatus: 'synced',
      details: `ServiceRequest: ${mapped.serviceRequestId || '-'} | Task: ${mapped.taskId || '-'}`,
      entity: 'referral',
    });
    publishDashboard();

    res.json({
      referral: mapReferral(row),
      fhir: {
        status: fhirResult.status,
        serviceRequestId: mapped.serviceRequestId || null,
        taskId: mapped.taskId || null,
        encounterId: mapped.encounterId || null,
      },
    });
  } catch (err) {
    const id = Number(req.params.id);
    if (id) {
      try {
        markReferralFailed(id, err.message);
        const failed = db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(id);
        if (failed) {
          logActivity({
            eventType: 'Referral',
            entityName: `${failed.LocalCode} - ${failed.PatientName}`,
            actionText: 'Referral re-sync failed',
            syncStatus: 'failed',
            details: String(err.message).slice(0, 480),
            entity: 'referral',
          });
        }
      } catch {
        // ignore secondary logging errors
      }
    }
    publishDashboard();
    res.status(err.status || 502).json({ error: err.message });
  }
});

router.post('/preview', (req, res) => {
  try {
    const draft = buildDraftPreviewBundle(req.body || {});
    res.json({
      preview: true,
      draft: true,
      ...draft,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const required = [
    'chiefComplaint',
    'workingImpression',
    'workingImpressionCode',
    'reasonText',
  ];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }
  if (!(b.patientId || b.patientFhirId)) {
    return res.status(400).json({ error: 'Missing fields: patientId or patientFhirId' });
  }

  const hasSendingOrg = b.sendingOrgId || b.sendingOrgFhirId;
  const hasReceivingOrg = b.receivingOrgId || b.receivingOrgFhirId;
  if (!hasSendingOrg || !hasReceivingOrg) {
    return res.status(400).json({
      error: 'Missing fields: sending and receiving facilities (local id or FHIR id)',
    });
  }

  const sameLocal =
    b.sendingOrgId &&
    b.receivingOrgId &&
    Number(b.sendingOrgId) === Number(b.receivingOrgId);
  const sameFhir =
    b.sendingOrgFhirId &&
    b.receivingOrgFhirId &&
    String(b.sendingOrgFhirId) === String(b.receivingOrgFhirId);
  if (sameLocal || sameFhir) {
    return res.status(400).json({ error: 'Sending and receiving facilities must be different.' });
  }

  try {
    let patient = await resolvePatientRef({
      patientId: b.patientId,
      patientFhirId: b.patientFhirId,
    });

    let sendingOrg = await resolveOrganizationRef({
      orgId: b.sendingOrgId,
      orgFhirId: b.sendingOrgFhirId,
      label: 'Sending',
    });
    let receivingOrg = await resolveOrganizationRef({
      orgId: b.receivingOrgId,
      orgFhirId: b.receivingOrgFhirId,
      label: 'Receiving',
    });

    let sendingPrac = await resolvePractitionerRef({
      pracId: b.sendingPracId,
      roleFhirId: b.sendingPracRoleFhirId,
      pracFhirId: b.sendingPracFhirId,
      label: 'Sending',
      organizationFhirId: sendingOrg.FhirId,
      optional: true,
    });
    let receivingPrac = await resolvePractitionerRef({
      pracId: b.receivingPracId,
      roleFhirId: b.receivingPracRoleFhirId,
      pracFhirId: b.receivingPracFhirId,
      label: 'Receiving',
      organizationFhirId: receivingOrg.FhirId,
      optional: true,
    });

    patient = await ensurePatientSynced(patient);
    if (sendingPrac) {
      sendingPrac = await ensurePractitionerSynced(sendingPrac, sendingOrg.FhirId);
    }
    if (receivingPrac) {
      receivingPrac = await ensurePractitionerSynced(receivingPrac, receivingOrg.FhirId);
    }

    if (!patient.FhirId || !sendingOrg.FhirId || !receivingOrg.FhirId) {
      return res.status(502).json({
        error:
          'Could not sync patient/facilities to FHIR. Ensure those records sync successfully first.',
      });
    }

    const category = resolveCategory(b);
    const reason = resolveReason(b);
    const stamp = Date.now().toString().slice(-8);
    const nextNum = db.prepare('SELECT COUNT(*) AS c FROM Referrals').get().c + 1;
    const localCode = b.localCode || `${TEAM_PREFIX}-R${String(nextNum).padStart(4, '0')}`;
    const requisitionValue = b.requisitionValue || `${TEAM_PREFIX}-REF-${stamp}`;
    const dateOfReferral = b.dateOfReferral || new Date().toISOString();
    const patientName = patientDisplay(patient);
    const sendingPracName = pracDisplay(sendingPrac);
    const receivingPracName = pracDisplay(receivingPrac);

    const insert = db.prepare(`
      INSERT INTO Referrals (
        LocalCode, RequisitionValue,
        PatientId, PatientFhirId, PatientName,
        SendingOrgId, SendingOrgFhirId, SendingOrgName,
        ReceivingOrgId, ReceivingOrgFhirId, ReceivingOrgName,
        SendingPracId, SendingPracFhirId, SendingPracName,
        ReceivingPracId, ReceivingPracFhirId, ReceivingPracName,
        CategoryCode, CategoryDisplay, CategoryText,
        ReasonCode, ReasonDisplay, ReasonText,
        ChiefComplaint, WorkingImpression, WorkingImpressionCode, WorkingImpressionDisplay,
        LinkedConditionFhirId, LinkedDiagnosisText,
        ClinicalHistory, TreatmentGiven,
        BpSystolic, BpDiastolic, HeartRate, RespiratoryRate, OxygenSaturation, Temperature, Weight,
        LabConclusion, ReferralNote, TaskNote, DateOfReferral,
        TaskStatus, Direction, SyncStatus
      ) VALUES (
        @LocalCode, @RequisitionValue,
        @PatientId, @PatientFhirId, @PatientName,
        @SendingOrgId, @SendingOrgFhirId, @SendingOrgName,
        @ReceivingOrgId, @ReceivingOrgFhirId, @ReceivingOrgName,
        @SendingPracId, @SendingPracFhirId, @SendingPracName,
        @ReceivingPracId, @ReceivingPracFhirId, @ReceivingPracName,
        @CategoryCode, @CategoryDisplay, @CategoryText,
        @ReasonCode, @ReasonDisplay, @ReasonText,
        @ChiefComplaint, @WorkingImpression, @WorkingImpressionCode, @WorkingImpressionDisplay,
        @LinkedConditionFhirId, @LinkedDiagnosisText,
        @ClinicalHistory, @TreatmentGiven,
        @BpSystolic, @BpDiastolic, @HeartRate, @RespiratoryRate, @OxygenSaturation, @Temperature, @Weight,
        @LabConclusion, @ReferralNote, @TaskNote, @DateOfReferral,
        'requested', 'sent', 'pending'
      )
    `);

    const info = insert.run({
      LocalCode: localCode,
      RequisitionValue: requisitionValue,
      PatientId: patient.Id,
      PatientFhirId: patient.FhirId,
      PatientName: patientName,
      SendingOrgId: sendingOrg.Id || null,
      SendingOrgFhirId: sendingOrg.FhirId,
      SendingOrgName: sendingOrg.Name,
      ReceivingOrgId: receivingOrg.Id || null,
      ReceivingOrgFhirId: receivingOrg.FhirId,
      ReceivingOrgName: receivingOrg.Name,
      SendingPracId: sendingPrac?.Id || null,
      SendingPracFhirId: sendingPrac?.FhirId || null,
      SendingPracName: sendingPracName,
      ReceivingPracId: receivingPrac?.Id || null,
      ReceivingPracFhirId: receivingPrac?.FhirId || null,
      ReceivingPracName: receivingPracName,
      CategoryCode: category.code,
      CategoryDisplay: category.display,
      CategoryText: category.text,
      ReasonCode: reason.code,
      ReasonDisplay: reason.display,
      ReasonText: b.reasonText || reason.text,
      ChiefComplaint: b.chiefComplaint,
      WorkingImpression: b.workingImpression,
      WorkingImpressionCode: b.workingImpressionCode || null,
      WorkingImpressionDisplay: b.workingImpressionDisplay || null,
      LinkedConditionFhirId: b.linkedConditionFhirId || null,
      LinkedDiagnosisText: b.linkedDiagnosisText || null,
      ClinicalHistory: b.clinicalHistory || null,
      TreatmentGiven: b.treatmentGiven || null,
      BpSystolic: b.bpSystolic != null && b.bpSystolic !== '' ? Number(b.bpSystolic) : null,
      BpDiastolic: b.bpDiastolic != null && b.bpDiastolic !== '' ? Number(b.bpDiastolic) : null,
      HeartRate: b.heartRate != null && b.heartRate !== '' ? Number(b.heartRate) : null,
      RespiratoryRate:
        b.respiratoryRate != null && b.respiratoryRate !== '' ? Number(b.respiratoryRate) : null,
      OxygenSaturation:
        b.oxygenSaturation != null && b.oxygenSaturation !== '' ? Number(b.oxygenSaturation) : null,
      Temperature: b.temperature != null && b.temperature !== '' ? Number(b.temperature) : null,
      Weight: b.weight != null && b.weight !== '' ? Number(b.weight) : null,
      LabConclusion: b.labConclusion || null,
      ReferralNote: b.referralNote || null,
      TaskNote: b.taskNote || null,
      DateOfReferral: dateOfReferral,
    });

    let row = db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(info.lastInsertRowid);
    const entityName = `${row.LocalCode} - ${row.PatientName}`;

    const bundle = buildReferralBundle({
      patient,
      sendingOrg,
      receivingOrg,
      sendingPrac,
      receivingPrac,
      data: {
        requisitionValue,
        dateOfReferral,
        patientName,
        categoryCode: category.code,
        categoryDisplay: category.display,
        categoryText: category.text,
        reasonCode: reason.code,
        reasonDisplay: reason.display,
        reasonText: row.ReasonText,
        chiefComplaint: row.ChiefComplaint,
        workingImpression: row.WorkingImpression,
        workingImpressionCode: row.WorkingImpressionCode,
        workingImpressionDisplay: row.WorkingImpressionDisplay,
        workingImpressionIcdCode: b.workingImpressionIcdCode || null,
        workingImpressionIcdDisplay: b.workingImpressionIcdDisplay || null,
        linkedConditionFhirId: row.LinkedConditionFhirId,
        clinicalHistory: row.ClinicalHistory,
        treatmentGiven: row.TreatmentGiven,
        bpSystolic: row.BpSystolic,
        bpDiastolic: row.BpDiastolic,
        heartRate: row.HeartRate,
        respiratoryRate: row.RespiratoryRate,
        oxygenSaturation: row.OxygenSaturation,
        temperature: row.Temperature,
        weight: row.Weight,
        labConclusion: row.LabConclusion,
        referralNote: row.ReferralNote,
        taskNote: row.TaskNote,
        practitionerRoleCode: sendingPrac?.RoleCode || DEFAULT_ROLE_CODE,
        practitionerRoleDisplay: sendingPrac?.RoleDisplay || DEFAULT_ROLE_DISPLAY,
      },
    });

    let fhirResult = null;
    try {
      fhirResult = await submitReferralBundle(bundle);
      const mapped = fhirResult.mapped || {};
      db.prepare(`
        UPDATE Referrals
        SET ServiceRequestFhirId = @ServiceRequestFhirId,
            TaskFhirId = @TaskFhirId,
            EncounterFhirId = @EncounterFhirId,
            SyncStatus = 'synced',
            SyncError = NULL,
            SyncedAt = datetime('now'),
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({
        Id: row.Id,
        ServiceRequestFhirId: mapped.serviceRequestId,
        TaskFhirId: mapped.taskId,
        EncounterFhirId: mapped.encounterId,
      });
      row = db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(row.Id);
      logActivity({
        eventType: 'Referral',
        entityName,
        actionText: 'Referral submitted',
        syncStatus: 'synced',
        details: `ServiceRequest: ${mapped.serviceRequestId || '-'} | Task: ${mapped.taskId || '-'}`,
        entity: 'referral',
      });
    } catch (fhirErr) {
      db.prepare(`
        UPDATE Referrals
        SET SyncStatus = 'failed',
            SyncError = @SyncError,
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({ Id: row.Id, SyncError: String(fhirErr.message).slice(0, 900) });
      row = db.prepare('SELECT * FROM Referrals WHERE Id = ?').get(row.Id);
      logActivity({
        eventType: 'Referral',
        entityName,
        actionText: 'Referral saved (FHIR failed)',
        syncStatus: 'failed',
        details: String(fhirErr.message).slice(0, 480),
        entity: 'referral',
      });
    }

    res.status(201).json({
      referral: mapReferral(row),
      fhir: fhirResult
        ? {
            status: fhirResult.status,
            serviceRequestId: fhirResult.mapped?.serviceRequestId || null,
            taskId: fhirResult.mapped?.taskId || null,
            encounterId: fhirResult.mapped?.encounterId || null,
          }
        : null,
    });
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.toLowerCase().includes('unique')) {
      return res.status(409).json({
        error: 'Referral with this local code or requisition already exists.',
      });
    }
    res.status(err.status || 500).json({ error: msg });
  }
});

module.exports = router;
