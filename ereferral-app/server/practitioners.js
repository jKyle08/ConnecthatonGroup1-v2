const express = require('express');
const { db } = require('./db');
const {
  putPractitioner,
  updatePractitionerById,
  getPractitioner,
  searchPractitioners,
  putPractitionerRole,
  updatePractitionerRoleById,
  getPractitionerRole,
  searchPractitionerRoles,
  attachRolesToPractitioners,
  buildPractitionerBundle,
  submitPractitionerBundle,
  DEFAULT_ROLE_CODE,
  DEFAULT_ROLE_DISPLAY,
  deleteResource,
  deduplicatePractitioners,
} = require('./fhir');
const { logActivity } = require('./activity');

const router = express.Router();
const TEAM_PREFIX = process.env.TEAM_PREFIX || 'TEAM07';

function mapPractitioner(row) {
  if (!row) return null;
  return {
    id: row.Id,
    localCode: row.LocalCode,
    prcId: row.PrcId,
    familyName: row.FamilyName,
    givenName: row.GivenName,
    prefix: row.Prefix,
    phone: row.Phone,
    gender: row.Gender || null,
    roleCode: row.RoleCode || null,
    roleDisplay: row.RoleDisplay || null,
    roleFhirId: row.RoleFhirId || null,
    organizationFhirId: row.OrganizationFhirId || null,
    fhirId: row.FhirId,
    syncStatus: row.SyncStatus,
    syncError: row.SyncError,
    syncedAt: row.SyncedAt,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
    source: 'local',
  };
}

function applyPracFields(b) {
  return {
    PrcId: b.prcId,
    FamilyName: b.familyName,
    GivenName: b.givenName,
    Prefix: b.prefix || null,
    Phone: b.phone || null,
    Gender: b.gender || null,
    RoleCode: b.roleCode || null,
    RoleDisplay: b.roleDisplay || null,
    OrganizationFhirId: b.organizationFhirId || null,
  };
}

function shouldSyncEmbeddedRole(row) {
  const orgId = row.OrganizationFhirId || row.organizationFhirId;
  const roleCode = row.RoleCode || row.roleCode;
  return Boolean(orgId && roleCode);
}

function displayName(row) {
  const prefix = row.Prefix ? `${row.Prefix} ` : '';
  return `${prefix}${row.GivenName} ${row.FamilyName} (${row.LocalCode})`;
}

async function syncPractitionerRole(row) {
  if (!row.RoleCode && !row.roleCode) return null;
  if (row.RoleFhirId || row.roleFhirId) {
    return updatePractitionerRoleById(row.RoleFhirId || row.roleFhirId, row);
  }
  return putPractitionerRole(row);
}

async function enrichFromFhirRoles(practitioners, { count = 200, q } = {}) {
  try {
    const roles = await searchPractitionerRoles({
      count: Math.max(count, practitioners.length || 200),
      q: q || undefined,
      all: true,
      maxPages: 100,
    });
    return {
      practitioners: attachRolesToPractitioners(practitioners, roles),
      roles,
    };
  } catch (err) {
    return {
      practitioners,
      roles: [],
      roleWarning: err.message,
    };
  }
}

function pracRecency(p) {
  return Date.parse(p.createdAt || p.updatedAt || p.syncedAt || '') || 0;
}

function sortPractitionersNewestFirst(practitioners) {
  return [...practitioners].sort((a, b) => {
    const tb = pracRecency(b);
    const ta = pracRecency(a);
    if (tb !== ta) return tb - ta;
    return (Number(b.fhirId) || 0) - (Number(a.fhirId) || 0);
  });
}

function matchesLocalPracQuery(prac, q) {
  if (!q) return true;
  const hay = [
    prac.localCode,
    prac.prcId,
    prac.familyName,
    prac.givenName,
    prac.prefix,
    prac.fhirId,
    prac.phone,
    prac.roleCode,
    prac.roleDisplay,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(String(q).toLowerCase());
}

function mergePracsWithLocal(fhirPractitioners, localPractitioners) {
  const byFhirId = new Map();
  const byPrc = new Map();
  for (const local of localPractitioners) {
    if (local.fhirId) byFhirId.set(String(local.fhirId), local);
    if (local.prcId && local.prcId !== '-') {
      byPrc.set(String(local.prcId), local);
    }
  }

  const usedLocalIds = new Set();
  const merged = fhirPractitioners.map((fp) => {
    const local =
      (fp.fhirId && byFhirId.get(String(fp.fhirId))) ||
      (fp.prcId && fp.prcId !== '-' && byPrc.get(String(fp.prcId))) ||
      null;
    if (!local) return { ...fp, source: 'fhir' };
    usedLocalIds.add(local.id);
    return {
      ...fp,
      id: local.id,
      localCode:
        local.localCode && local.localCode !== '-' ? local.localCode : fp.localCode,
      roleCode: local.roleCode || fp.roleCode || null,
      roleDisplay: local.roleDisplay || fp.roleDisplay || null,
      roleFhirId: local.roleFhirId || fp.roleFhirId || null,
      organizationFhirId: local.organizationFhirId || fp.organizationFhirId || null,
      syncStatus: local.syncStatus || fp.syncStatus || 'synced',
      syncError: local.syncError || null,
      syncedAt: local.syncedAt || fp.syncedAt,
      createdAt: local.createdAt || fp.createdAt,
      updatedAt: local.updatedAt || fp.updatedAt,
      source: 'fhir',
    };
  });

  const localOnly = localPractitioners
    .filter((local) => !usedLocalIds.has(local.id))
    .map((local) => ({ ...local, source: local.fhirId ? 'fhir' : 'local' }));

  return sortPractitionersNewestFirst(deduplicatePractitioners([...localOnly, ...merged]));
}

function loadLocalPractitioners() {
  try {
    return db
      .prepare('SELECT * FROM Practitioners ORDER BY datetime(CreatedAt) DESC')
      .all()
      .map(mapPractitioner);
  } catch {
    return [];
  }
}

router.get('/roles', async (req, res) => {
  try {
    const roles = await searchPractitionerRoles({
      count: Number(req.query.count) || 200,
      q: req.query.q ? String(req.query.q).trim() : undefined,
      practitionerFhirId: req.query.practitioner
        ? String(req.query.practitioner).trim()
        : undefined,
      organizationFhirId: req.query.organization
        ? String(req.query.organization).trim()
        : undefined,
      all: true,
      maxPages: 100,
    });
    res.json({
      source: 'fhir',
      roles,
      total: roles.length,
      warning: `Loaded ${roles.length} practitioner role(s) from FHIR API`,
    });
  } catch (err) {
    const detail = err.cause?.message || err.message || 'Unknown error';
    res.status(502).json({
      error: `Could not fetch practitioner roles from FHIR API: ${detail}`,
    });
  }
});

router.get('/', async (req, res) => {
  const sourcePref = String(req.query.source || 'fhir').toLowerCase();
  const forceLocal = sourcePref === 'local';
  const includeRoles = String(req.query.includeRoles || 'true').toLowerCase() !== 'false';
  const q = req.query.q ? String(req.query.q).trim() : '';
  const count = Math.min(500, Math.max(1, Number(req.query.count) || 200));
  const localPractitioners = loadLocalPractitioners();

  if (forceLocal) {
    let practitioners = localPractitioners;
    if (q) practitioners = practitioners.filter((p) => matchesLocalPracQuery(p, q));
    practitioners = sortPractitionersNewestFirst(practitioners);
    if (includeRoles) {
      const enriched = await enrichFromFhirRoles(practitioners, {
        count,
        q: q || undefined,
      });
      return res.json({
        source: 'local',
        practitioners: enriched.practitioners,
        roles: enriched.roles,
        total: enriched.practitioners.length,
        warning: enriched.roleWarning
          ? `Local practitioners loaded. PractitionerRole fetch warning: ${enriched.roleWarning}`
          : null,
      });
    }
    return res.json({
      source: 'local',
      practitioners,
      total: practitioners.length,
      warning: null,
    });
  }

  try {
    const fhirPractitioners = await searchPractitioners({
      count,
      q: q || undefined,
      all: true,
      maxPages: 100,
    });
    let practitioners = mergePracsWithLocal(fhirPractitioners, localPractitioners);
    if (q) practitioners = practitioners.filter((p) => matchesLocalPracQuery(p, q));

    let payload = {
      source: 'fhir',
      practitioners,
      total: practitioners.length,
      warning: `Loaded ${practitioners.length} practitioner(s) from FHIR${
        localPractitioners.length ? ` (merged with ${localPractitioners.length} local)` : ''
      }.`,
    };

    if (includeRoles) {
      const enriched = await enrichFromFhirRoles(practitioners, {
        count,
        q: q || undefined,
      });
      payload = {
        ...payload,
        practitioners: enriched.practitioners,
        roles: enriched.roles,
        total: enriched.practitioners.length,
        warning: enriched.roleWarning
          ? `${payload.warning} PractitionerRole fetch warning: ${enriched.roleWarning}`
          : `${payload.warning} Including ${enriched.roles.length} PractitionerRole(s).`,
      };
    }

    return res.json(payload);
  } catch (err) {
    const detail = err.cause?.message || err.message || 'Unknown error';
    let practitioners = localPractitioners;
    if (q) practitioners = practitioners.filter((p) => matchesLocalPracQuery(p, q));
    practitioners = sortPractitionersNewestFirst(practitioners);
    if (practitioners.length) {
      return res.json({
        source: 'local',
        practitioners,
        total: practitioners.length,
        warning: `FHIR Practitioner API unavailable (${detail}). Showing ${practitioners.length} local record(s).`,
      });
    }
    res.status(502).json({
      error: `Could not fetch practitioners from FHIR API: ${detail}`,
    });
  }
});

router.get('/fhir/:fhirId', async (req, res) => {
  try {
    const practitioner = await getPractitioner(req.params.fhirId);
    try {
      const roles = await searchPractitionerRoles({
        practitionerFhirId: req.params.fhirId,
        count: 10,
      });
      const [enriched] = attachRolesToPractitioners([practitioner], roles);
      return res.json(enriched);
    } catch {
      return res.json(practitioner);
    }
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM Practitioners WHERE Id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Practitioner not found' });
    let practitioner = mapPractitioner(row);
    if (practitioner.fhirId || practitioner.prcId) {
      try {
        const roles = await searchPractitionerRoles({
          practitionerFhirId: practitioner.fhirId || undefined,
          q: practitioner.prcId || undefined,
          count: 10,
        });
        [practitioner] = attachRolesToPractitioners([practitioner], roles);
      } catch {
        // Keep local role fields if FHIR role lookup fails.
      }
    }
    res.json(practitioner);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bundle-preview', (req, res) => {
  const b = req.body || {};
  try {
    const bundle = buildPractitionerBundle(b);
    res.json({ bundle });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const required = ['prcId', 'familyName', 'givenName'];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  try {
    const nextNum = (db.prepare('SELECT COUNT(*) AS c FROM Practitioners').get()?.c || 0) + 1;
    const localCode = b.localCode || `${TEAM_PREFIX}-R${String(nextNum).padStart(4, '0')}`;
    const fields = applyPracFields(b);

    const insert = db.prepare(`
      INSERT INTO Practitioners (
        LocalCode, PrcId, FamilyName, GivenName, Prefix, Phone, Gender,
        RoleCode, RoleDisplay, OrganizationFhirId, SyncStatus
      ) VALUES (
        @LocalCode, @PrcId, @FamilyName, @GivenName, @Prefix, @Phone, @Gender,
        @RoleCode, @RoleDisplay, @OrganizationFhirId, 'pending'
      )
    `);

    const info = insert.run({
      LocalCode: localCode,
      ...fields,
    });

    let row = db.prepare('SELECT * FROM Practitioners WHERE Id = ?').get(info.lastInsertRowid) || {
      Id: info.lastInsertRowid,
      LocalCode: localCode,
      ...fields,
    };
    const name = displayName(row);

    let fhirResult = null;
    let roleResult = null;
    let transactionResult = null;

    try {
      if (b.roleCode || b.organizationFhirId) {
        // Submit atomically as a FHIR Transaction Bundle
        const bundle = buildPractitionerBundle({ ...row, ...b });
        transactionResult = await submitPractitionerBundle(bundle);
        fhirResult = {
          fhirId: transactionResult.practitionerFhirId,
          status: transactionResult.status,
        };
        if (transactionResult.roleFhirId) {
          roleResult = {
            fhirId: transactionResult.roleFhirId,
            status: transactionResult.status,
          };
        }
      } else {
        fhirResult = await putPractitioner(row);
      }

      row = {
        ...row,
        FhirId: fhirResult?.fhirId || row.FhirId || null,
        RoleFhirId: roleResult?.fhirId || row.RoleFhirId || null,
      };

      db.prepare(`
        UPDATE Practitioners
        SET FhirId = @FhirId,
            RoleFhirId = @RoleFhirId,
            SyncStatus = 'synced',
            SyncError = NULL,
            SyncedAt = datetime('now'),
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({
        Id: row.Id,
        FhirId: row.FhirId,
        RoleFhirId: row.RoleFhirId,
      });

      row = db.prepare('SELECT * FROM Practitioners WHERE Id = ?').get(row.Id) || row;
      logActivity({
        eventType: 'Practitioner',
        entityName: name,
        actionText: 'Practitioner & Role saved (Bundle)',
        syncStatus: 'synced',
        details: `Practitioner FHIR ID: ${row.FhirId}${row.RoleFhirId ? `; Role: ${row.RoleFhirId}` : ''}`,
      });
    } catch (fhirErr) {
      db.prepare(`
        UPDATE Practitioners
        SET SyncStatus = 'failed',
            SyncError = @SyncError,
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({ Id: row.Id, SyncError: fhirErr.message });

      row = db.prepare('SELECT * FROM Practitioners WHERE Id = ?').get(row.Id) || row;
      logActivity({
        eventType: 'Practitioner',
        entityName: name,
        actionText: 'Practitioner saved (FHIR failed)',
        syncStatus: 'failed',
        details: String(fhirErr.message).slice(0, 480),
      });
    }

    res.status(201).json({
      practitioner: mapPractitioner(row),
      fhir: fhirResult ? { id: fhirResult.fhirId, status: fhirResult.status } : null,
      role: roleResult ? { id: roleResult.fhirId, status: roleResult.status } : null,
      bundle: transactionResult?.bundleResponse || null,
    });
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.toLowerCase().includes('unique')) {
      return res.status(409).json({
        error: 'Practitioner with this PRC ID or Local Code already exists locally.',
      });
    }
    res.status(500).json({ error: msg });
  }
});

router.put('/fhir/:fhirId', async (req, res) => {
  const b = req.body || {};
  const required = ['prcId', 'familyName', 'givenName'];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  try {
    let fhirResult = null;
    let roleResult = null;
    let transactionResult = null;

    if (b.roleCode || b.organizationFhirId) {
      const bundle = buildPractitionerBundle({ ...b, fhirId: req.params.fhirId, RoleFhirId: b.roleFhirId });
      transactionResult = await submitPractitionerBundle(bundle);
      fhirResult = {
        fhirId: transactionResult.practitionerFhirId || req.params.fhirId,
        status: transactionResult.status,
      };
      if (transactionResult.roleFhirId || b.roleFhirId) {
        roleResult = {
          fhirId: transactionResult.roleFhirId || b.roleFhirId,
          status: transactionResult.status,
        };
      }
    } else {
      fhirResult = await updatePractitionerById(req.params.fhirId, b);
    }

    const practitioner = await getPractitioner(req.params.fhirId);
    const [enriched] = attachRolesToPractitioners(
      [
        {
          ...practitioner,
          roleCode: b.roleCode || practitioner.roleCode,
          roleDisplay: b.roleDisplay || practitioner.roleDisplay,
          roleFhirId: roleResult?.fhirId || b.roleFhirId || null,
          organizationFhirId: b.organizationFhirId || null,
        },
      ],
      roleResult?.fhirId ? [await getPractitionerRole(roleResult.fhirId).catch(() => null)].filter(Boolean) : []
    );
    logActivity({
      eventType: 'Practitioner',
      entityName: `${b.prefix ? `${b.prefix} ` : ''}${b.givenName} ${b.familyName}`,
      actionText: 'Practitioner & Role updated on FHIR (Bundle)',
      syncStatus: 'synced',
      details: `FHIR ID: ${req.params.fhirId}${roleResult?.fhirId ? `; Role: ${roleResult.fhirId}` : ''}`,
    });
    res.json({
      practitioner: enriched,
      fhir: { id: fhirResult.fhirId, status: fhirResult.status },
      role: roleResult ? { id: roleResult.fhirId, status: roleResult.status } : null,
      bundle: transactionResult?.bundleResponse || null,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const b = req.body || {};
  const required = ['prcId', 'familyName', 'givenName'];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  try {
    const existing = db.prepare('SELECT * FROM Practitioners WHERE Id = ?').get(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Practitioner not found' });

    const fields = applyPracFields(b);
    db.prepare(`
      UPDATE Practitioners SET
        PrcId = @PrcId,
        FamilyName = @FamilyName,
        GivenName = @GivenName,
        Prefix = @Prefix,
        Phone = @Phone,
        Gender = @Gender,
        RoleCode = @RoleCode,
        RoleDisplay = @RoleDisplay,
        OrganizationFhirId = @OrganizationFhirId,
        UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({ Id: existing.Id, ...fields });

    let row = db.prepare('SELECT * FROM Practitioners WHERE Id = ?').get(existing.Id);
    const name = displayName(row);

    let fhirResult = null;
    let roleResult = null;
    try {
      if (row.FhirId) {
        fhirResult = await updatePractitionerById(row.FhirId, row);
      } else {
        fhirResult = await putPractitioner(row);
      }
      row = { ...row, FhirId: fhirResult.fhirId };
      if (shouldSyncEmbeddedRole(row)) {
        roleResult = await syncPractitionerRole(row);
      }

      db.prepare(`
        UPDATE Practitioners
        SET FhirId = @FhirId,
            RoleFhirId = @RoleFhirId,
            SyncStatus = 'synced',
            SyncError = NULL,
            SyncedAt = datetime('now'),
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({
        Id: row.Id,
        FhirId: fhirResult.fhirId,
        RoleFhirId: roleResult?.fhirId || row.RoleFhirId || null,
      });

      row = db.prepare('SELECT * FROM Practitioners WHERE Id = ?').get(row.Id);
      logActivity({
        eventType: 'Practitioner',
        entityName: name,
        actionText: 'Practitioner updated',
        syncStatus: 'synced',
        details: `FHIR ID: ${fhirResult.fhirId}${roleResult?.fhirId ? `; Role: ${roleResult.fhirId}` : ''}`,
      });
    } catch (fhirErr) {
      db.prepare(`
        UPDATE Practitioners
        SET SyncStatus = 'failed',
            SyncError = @SyncError,
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({ Id: row.Id, SyncError: fhirErr.message });

      row = db.prepare('SELECT * FROM Practitioners WHERE Id = ?').get(row.Id);
      logActivity({
        eventType: 'Practitioner',
        entityName: name,
        actionText: 'Practitioner updated (FHIR failed)',
        syncStatus: 'failed',
        details: String(fhirErr.message).slice(0, 480),
      });
    }

    res.json({
      practitioner: mapPractitioner(row),
      fhir: fhirResult ? { id: fhirResult.fhirId, status: fhirResult.status } : null,
      role: roleResult ? { id: roleResult.fhirId, status: roleResult.status } : null,
    });
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.toLowerCase().includes('unique')) {
      return res.status(409).json({
        error: 'Practitioner with this PRC ID or Local Code already exists locally.',
      });
    }
    res.status(500).json({ error: msg });
  }
});

router.post('/:id/sync', async (req, res) => {
  try {
    let row = db.prepare('SELECT * FROM Practitioners WHERE Id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Practitioner not found' });

    const name = displayName(row);
    const fhirResult = row.FhirId
      ? await updatePractitionerById(row.FhirId, row)
      : await putPractitioner(row);
    row = { ...row, FhirId: fhirResult.fhirId };
    const roleResult = shouldSyncEmbeddedRole(row) ? await syncPractitionerRole(row) : null;

    db.prepare(`
      UPDATE Practitioners
      SET FhirId = @FhirId,
          RoleFhirId = @RoleFhirId,
          SyncStatus = 'synced',
          SyncError = NULL,
          SyncedAt = datetime('now'),
          UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({
      Id: row.Id,
      FhirId: fhirResult.fhirId,
      RoleFhirId: roleResult?.fhirId || row.RoleFhirId || null,
    });

    row = db.prepare('SELECT * FROM Practitioners WHERE Id = ?').get(row.Id);
    logActivity({
      eventType: 'Practitioner',
      entityName: name,
      actionText: 'Practitioner re-synced',
      syncStatus: 'synced',
      details: `FHIR ID: ${fhirResult.fhirId}${roleResult?.fhirId ? `; Role: ${roleResult.fhirId}` : ''}`,
    });

    res.json({
      practitioner: mapPractitioner(row),
      fhir: { id: fhirResult.fhirId, status: fhirResult.status },
      role: roleResult ? { id: roleResult.fhirId, status: roleResult.status } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function deletePractitionerFhir(rowOrFhirId) {
  const fhirId = typeof rowOrFhirId === 'string' ? rowOrFhirId : rowOrFhirId?.FhirId;
  const roleFhirId = typeof rowOrFhirId === 'object' ? rowOrFhirId?.RoleFhirId : null;
  const warnings = [];
  let fhir = null;
  let role = null;

  if (roleFhirId) {
    try {
      role = await deleteResource('PractitionerRole', roleFhirId);
    } catch (err) {
      warnings.push(err.message);
    }
  }
  if (fhirId) {
    try {
      fhir = await deleteResource('Practitioner', fhirId);
    } catch (err) {
      warnings.push(err.message);
    }
  }

  return {
    fhir,
    role,
    fhirWarning: warnings.length ? warnings.join(' | ') : null,
  };
}

router.delete('/fhir/:fhirId', async (req, res) => {
  const fhirId = String(req.params.fhirId || '').trim();
  if (!fhirId) return res.status(400).json({ error: 'FHIR ID is required' });

  try {
    const local = db.prepare('SELECT * FROM Practitioners WHERE FhirId = ?').get(fhirId);
    if (local) {
      db.prepare('DELETE FROM Practitioners WHERE Id = ?').run(local.Id);
    }

    const { fhir, role, fhirWarning } = await deletePractitionerFhir(local || fhirId);
    const name = local ? displayName(local) : `Practitioner/${fhirId}`;

    logActivity({
      eventType: 'Practitioner',
      entityName: name,
      actionText: fhirWarning ? 'Practitioner deleted (FHIR warning)' : 'Practitioner deleted',
      syncStatus: fhirWarning ? 'failed' : 'synced',
      details: fhirWarning || `FHIR ID: ${fhirId}`,
    });

    res.json({
      ok: true,
      deletedLocal: Boolean(local),
      fhir,
      role,
      fhirWarning,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM Practitioners WHERE Id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Practitioner not found' });

    const name = displayName(row);
    const { fhir, role, fhirWarning } = await deletePractitionerFhir(row);

    db.prepare('DELETE FROM Practitioners WHERE Id = ?').run(row.Id);

    logActivity({
      eventType: 'Practitioner',
      entityName: name,
      actionText: fhirWarning ? 'Practitioner deleted (FHIR warning)' : 'Practitioner deleted',
      syncStatus: fhirWarning ? 'failed' : 'synced',
      details: fhirWarning || (row.FhirId ? `FHIR ID: ${row.FhirId}` : 'Local only'),
    });

    res.json({
      ok: true,
      deletedLocal: true,
      fhir,
      role,
      fhirWarning,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
