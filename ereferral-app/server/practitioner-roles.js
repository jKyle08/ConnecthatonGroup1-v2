const express = require('express');
const { db } = require('./db');
const {
  putPractitionerRole,
  updatePractitionerRoleById,
  getPractitionerRole,
  searchPractitionerRoles,
  DEFAULT_ROLE_CODE,
  DEFAULT_ROLE_DISPLAY,
  deleteResource,
} = require('./fhir');
const { logActivity } = require('./activity');

const router = express.Router();
const TEAM_PREFIX = process.env.TEAM_PREFIX || 'TEAM07';

function mapRole(row) {
  if (!row) return null;
  return {
    id: row.Id,
    localCode: row.LocalCode,
    prcId: row.PrcId,
    practitionerFhirId: row.PractitionerFhirId || null,
    practitionerName: row.PractitionerName || null,
    organizationFhirId: row.OrganizationFhirId || null,
    organizationName: row.OrganizationName || null,
    roleCode: row.RoleCode || null,
    roleDisplay: row.RoleDisplay || null,
    active: row.Active === undefined || row.Active === null ? true : Boolean(row.Active),
    fhirId: row.FhirId,
    syncStatus: row.SyncStatus,
    syncError: row.SyncError,
    syncedAt: row.SyncedAt,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
    source: 'local',
  };
}

function applyRoleFields(b) {
  const active =
    b.active === undefined || b.active === null
      ? 1
      : b.active === false || b.active === 0 || b.active === '0' || b.active === 'false'
        ? 0
        : 1;
  return {
    PrcId: b.prcId,
    PractitionerFhirId: b.practitionerFhirId || null,
    PractitionerName: b.practitionerName || null,
    OrganizationFhirId: b.organizationFhirId || null,
    OrganizationName: b.organizationName || null,
    RoleCode: b.roleCode || DEFAULT_ROLE_CODE,
    RoleDisplay: b.roleDisplay || DEFAULT_ROLE_DISPLAY,
    Active: active,
  };
}

function displayName(row) {
  const role = row.RoleDisplay || row.roleDisplay || 'PractitionerRole';
  const prac = row.PractitionerName || row.practitionerName || row.PrcId || row.prcId || '';
  return prac ? `${role} - ${prac}` : role;
}

function roleRecency(r) {
  return Date.parse(r.createdAt || r.updatedAt || r.syncedAt || '') || 0;
}

function sortRolesNewestFirst(roles) {
  return [...roles].sort((a, b) => {
    const tb = roleRecency(b);
    const ta = roleRecency(a);
    if (tb !== ta) return tb - ta;
    return (Number(b.fhirId) || 0) - (Number(a.fhirId) || 0);
  });
}

function matchesLocalRoleQuery(role, q) {
  if (!q) return true;
  const hay = [
    role.localCode,
    role.prcId,
    role.practitionerFhirId,
    role.practitionerName,
    role.organizationFhirId,
    role.organizationName,
    role.roleCode,
    role.roleDisplay,
    role.fhirId,
    role.active === false ? 'inactive' : 'active',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(String(q).toLowerCase());
}

function mergeRolesWithLocal(fhirRoles, localRoles) {
  const byFhirId = new Map();
  const byPrc = new Map();
  for (const local of localRoles) {
    if (local.fhirId) byFhirId.set(String(local.fhirId), local);
    if (local.prcId && local.prcId !== '-') {
      byPrc.set(String(local.prcId).toLowerCase(), local);
    }
  }

  const usedLocalIds = new Set();
  const merged = fhirRoles.map((fr) => {
    const local =
      (fr.fhirId && byFhirId.get(String(fr.fhirId))) ||
      (fr.prcId && fr.prcId !== '-' && byPrc.get(String(fr.prcId).toLowerCase())) ||
      null;
    if (!local) return { ...fr, source: 'fhir' };
    usedLocalIds.add(local.id);
    return {
      ...fr,
      id: local.id,
      localCode:
        local.localCode && local.localCode !== '-' ? local.localCode : fr.localCode,
      practitionerName: local.practitionerName || fr.practitionerName || null,
      organizationName: local.organizationName || fr.organizationName || null,
      active: local.active !== undefined ? local.active : fr.active !== false,
      syncStatus: local.syncStatus || fr.syncStatus || 'synced',
      syncError: local.syncError || null,
      syncedAt: local.syncedAt || fr.syncedAt,
      createdAt: local.createdAt || fr.createdAt,
      updatedAt: local.updatedAt || fr.updatedAt,
      source: 'fhir',
    };
  });

  const localOnly = localRoles
    .filter((local) => !usedLocalIds.has(local.id))
    .map((local) => ({ ...local, source: local.fhirId ? 'fhir' : 'local' }));

  return sortRolesNewestFirst([...localOnly, ...merged]);
}

function loadLocalRoles() {
  try {
    return db
      .prepare('SELECT * FROM PractitionerRoles ORDER BY datetime(CreatedAt) DESC')
      .all()
      .map(mapRole);
  } catch {
    return [];
  }
}

async function syncRoleToFhir(row) {
  const payload = {
    prcId: row.PrcId || row.prcId,
    roleCode: row.RoleCode || row.roleCode,
    roleDisplay: row.RoleDisplay || row.roleDisplay,
    roleSystem: row.RoleSystem || row.roleSystem,
    practitionerFhirId: row.PractitionerFhirId || row.practitionerFhirId,
    organizationFhirId: row.OrganizationFhirId || row.organizationFhirId,
    active: row.Active === undefined || row.Active === null ? true : Boolean(row.Active ?? row.active),
  };
  if (row.FhirId || row.fhirId) {
    return updatePractitionerRoleById(row.FhirId || row.fhirId, payload);
  }
  return putPractitionerRole(payload);
}

router.get('/', async (req, res) => {
  const sourcePref = String(req.query.source || 'fhir').toLowerCase();
  const forceLocal = sourcePref === 'local';
  const q = req.query.q ? String(req.query.q).trim() : '';
  const count = Math.min(500, Math.max(1, Number(req.query.count) || 200));
  const practitionerFhirId = req.query.practitioner
    ? String(req.query.practitioner).trim()
    : undefined;
  const organizationFhirId = req.query.organization
    ? String(req.query.organization).trim()
    : undefined;
  const localRoles = loadLocalRoles();

  if (forceLocal) {
    let roles = localRoles;
    if (q) roles = roles.filter((r) => matchesLocalRoleQuery(r, q));
    if (practitionerFhirId) {
      roles = roles.filter((r) => String(r.practitionerFhirId || '') === practitionerFhirId);
    }
    if (organizationFhirId) {
      roles = roles.filter((r) => String(r.organizationFhirId || '') === organizationFhirId);
    }
    roles = sortRolesNewestFirst(roles);
    return res.json({
      source: 'local',
      roles,
      total: roles.length,
      warning: null,
    });
  }

  try {
    const fhirRoles = await searchPractitionerRoles({
      count,
      q: q || undefined,
      practitionerFhirId,
      organizationFhirId,
      all: true,
      maxPages: 100,
    });
    let roles = mergeRolesWithLocal(fhirRoles, localRoles);
    if (q) roles = roles.filter((r) => matchesLocalRoleQuery(r, q));

    return res.json({
      source: 'fhir',
      roles,
      total: roles.length,
      warning: `Loaded ${roles.length} practitioner role(s) from FHIR${
        localRoles.length ? ` (merged with ${localRoles.length} local)` : ''
      }.`,
    });
  } catch (err) {
    const detail = err.cause?.message || err.message || 'Unknown error';
    let roles = localRoles;
    if (q) roles = roles.filter((r) => matchesLocalRoleQuery(r, q));
    roles = sortRolesNewestFirst(roles);
    if (roles.length) {
      return res.json({
        source: 'local',
        roles,
        total: roles.length,
        warning: `FHIR PractitionerRole API unavailable (${detail}). Showing ${roles.length} local record(s).`,
      });
    }
    res.status(502).json({
      error: `Could not fetch practitioner roles from FHIR API: ${detail}`,
    });
  }
});

router.get('/fhir/:fhirId', async (req, res) => {
  try {
    const role = await getPractitionerRole(req.params.fhirId);
    res.json(role);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const row = db
      .prepare('SELECT * FROM PractitionerRoles WHERE Id = ?')
      .get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Practitioner role not found' });
    res.json(mapRole(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const required = ['prcId', 'practitionerFhirId', 'roleCode', 'roleDisplay'];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  try {
    const nextNum = db.prepare('SELECT COUNT(*) AS c FROM PractitionerRoles').get().c + 1;
    const localCode = b.localCode || `${TEAM_PREFIX}-PR${String(nextNum).padStart(4, '0')}`;
    const fields = applyRoleFields(b);

    const insert = db.prepare(`
      INSERT INTO PractitionerRoles (
        LocalCode, PrcId, PractitionerFhirId, PractitionerName,
        OrganizationFhirId, OrganizationName, RoleCode, RoleDisplay, Active, SyncStatus
      ) VALUES (
        @LocalCode, @PrcId, @PractitionerFhirId, @PractitionerName,
        @OrganizationFhirId, @OrganizationName, @RoleCode, @RoleDisplay, @Active, 'pending'
      )
    `);

    const info = insert.run({
      LocalCode: localCode,
      ...fields,
    });

    let row = db.prepare('SELECT * FROM PractitionerRoles WHERE Id = ?').get(info.lastInsertRowid);
    const name = displayName(row);

    let fhirResult = null;
    try {
      fhirResult = await syncRoleToFhir({ ...row, roleSystem: b.roleSystem || b.RoleSystem });
      db.prepare(`
        UPDATE PractitionerRoles
        SET FhirId = @FhirId,
            SyncStatus = 'synced',
            SyncError = NULL,
            SyncedAt = datetime('now'),
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({ Id: row.Id, FhirId: fhirResult.fhirId });

      row = db.prepare('SELECT * FROM PractitionerRoles WHERE Id = ?').get(row.Id);
      logActivity({
        eventType: 'PractitionerRole',
        entityName: name,
        actionText: 'Practitioner role saved',
        syncStatus: 'synced',
        details: `FHIR ID: ${fhirResult.fhirId}`,
      });
    } catch (fhirErr) {
      db.prepare(`
        UPDATE PractitionerRoles
        SET SyncStatus = 'failed',
            SyncError = @SyncError,
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({ Id: row.Id, SyncError: fhirErr.message });

      row = db.prepare('SELECT * FROM PractitionerRoles WHERE Id = ?').get(row.Id);
      logActivity({
        eventType: 'PractitionerRole',
        entityName: name,
        actionText: 'Practitioner role saved (FHIR failed)',
        syncStatus: 'failed',
        details: String(fhirErr.message).slice(0, 480),
      });
    }

    res.status(201).json({
      role: mapRole(row),
      fhir: fhirResult ? { id: fhirResult.fhirId, status: fhirResult.status } : null,
    });
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.toLowerCase().includes('unique')) {
      return res.status(409).json({
        error: 'Practitioner role with this Local Code already exists locally.',
      });
    }
    res.status(500).json({ error: msg });
  }
});

router.put('/fhir/:fhirId', async (req, res) => {
  const b = req.body || {};
  const required = ['prcId', 'practitionerFhirId', 'roleCode', 'roleDisplay'];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  try {
    const fields = applyRoleFields(b);
    const fhirResult = await updatePractitionerRoleById(req.params.fhirId, {
      ...fields,
      prcId: fields.PrcId,
      practitionerFhirId: fields.PractitionerFhirId,
      organizationFhirId: fields.OrganizationFhirId,
      roleCode: fields.RoleCode,
      roleDisplay: fields.RoleDisplay,
      roleSystem: b.roleSystem || b.RoleSystem,
      active: Boolean(fields.Active),
    });
    const role = await getPractitionerRole(req.params.fhirId);
    logActivity({
      eventType: 'PractitionerRole',
      entityName: b.practitionerName || b.roleDisplay || `PractitionerRole/${req.params.fhirId}`,
      actionText: 'Practitioner role updated on FHIR',
      syncStatus: 'synced',
      details: `FHIR ID: ${req.params.fhirId}`,
    });
    res.json({
      role: {
        ...role,
        practitionerName: b.practitionerName || role.practitionerName,
        organizationName: b.organizationName || role.organizationName,
        active: fields.Active === 1,
      },
      fhir: { id: fhirResult.fhirId, status: fhirResult.status },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const b = req.body || {};
  const required = ['prcId', 'practitionerFhirId', 'roleCode', 'roleDisplay'];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  try {
    const existing = db
      .prepare('SELECT * FROM PractitionerRoles WHERE Id = ?')
      .get(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Practitioner role not found' });

    const fields = applyRoleFields(b);
    db.prepare(`
      UPDATE PractitionerRoles SET
        PrcId = @PrcId,
        PractitionerFhirId = @PractitionerFhirId,
        PractitionerName = @PractitionerName,
        OrganizationFhirId = @OrganizationFhirId,
        OrganizationName = @OrganizationName,
        RoleCode = @RoleCode,
        RoleDisplay = @RoleDisplay,
        Active = @Active,
        UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({ Id: existing.Id, ...fields });

    let row = db.prepare('SELECT * FROM PractitionerRoles WHERE Id = ?').get(existing.Id);
    const name = displayName(row);

    let fhirResult = null;
    try {
      fhirResult = await syncRoleToFhir({ ...row, roleSystem: b.roleSystem || b.RoleSystem });
      db.prepare(`
        UPDATE PractitionerRoles
        SET FhirId = @FhirId,
            SyncStatus = 'synced',
            SyncError = NULL,
            SyncedAt = datetime('now'),
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({ Id: row.Id, FhirId: fhirResult.fhirId });

      row = db.prepare('SELECT * FROM PractitionerRoles WHERE Id = ?').get(row.Id);
      logActivity({
        eventType: 'PractitionerRole',
        entityName: name,
        actionText: 'Practitioner role updated',
        syncStatus: 'synced',
        details: `FHIR ID: ${fhirResult.fhirId}`,
      });
    } catch (fhirErr) {
      db.prepare(`
        UPDATE PractitionerRoles
        SET SyncStatus = 'failed',
            SyncError = @SyncError,
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({ Id: row.Id, SyncError: fhirErr.message });

      row = db.prepare('SELECT * FROM PractitionerRoles WHERE Id = ?').get(row.Id);
      logActivity({
        eventType: 'PractitionerRole',
        entityName: name,
        actionText: 'Practitioner role updated (FHIR failed)',
        syncStatus: 'failed',
        details: String(fhirErr.message).slice(0, 480),
      });
    }

    res.json({
      role: mapRole(row),
      fhir: fhirResult ? { id: fhirResult.fhirId, status: fhirResult.status } : null,
    });
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.toLowerCase().includes('unique')) {
      return res.status(409).json({
        error: 'Practitioner role with this Local Code already exists locally.',
      });
    }
    res.status(500).json({ error: msg });
  }
});

router.post('/:id/sync', async (req, res) => {
  try {
    let row = db
      .prepare('SELECT * FROM PractitionerRoles WHERE Id = ?')
      .get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Practitioner role not found' });

    const name = displayName(row);
    const fhirResult = await syncRoleToFhir(row);

    db.prepare(`
      UPDATE PractitionerRoles
      SET FhirId = @FhirId,
          SyncStatus = 'synced',
          SyncError = NULL,
          SyncedAt = datetime('now'),
          UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({ Id: row.Id, FhirId: fhirResult.fhirId });

    row = db.prepare('SELECT * FROM PractitionerRoles WHERE Id = ?').get(row.Id);
    logActivity({
      eventType: 'PractitionerRole',
      entityName: name,
      actionText: 'Practitioner role re-synced',
      syncStatus: 'synced',
      details: `FHIR ID: ${fhirResult.fhirId}`,
    });

    res.json({
      role: mapRole(row),
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
    const local = db.prepare('SELECT * FROM PractitionerRoles WHERE FhirId = ?').get(fhirId);
    if (local) {
      db.prepare('DELETE FROM PractitionerRoles WHERE Id = ?').run(local.Id);
    }

    let fhir = null;
    let fhirWarning = null;
    try {
      fhir = await deleteResource('PractitionerRole', fhirId);
    } catch (fhirErr) {
      fhirWarning = fhirErr.message;
    }

    const name = local ? displayName(local) : `PractitionerRole/${fhirId}`;
    logActivity({
      eventType: 'PractitionerRole',
      entityName: name,
      actionText: fhirWarning ? 'Practitioner role deleted (FHIR warning)' : 'Practitioner role deleted',
      syncStatus: fhirWarning ? 'failed' : 'synced',
      details: fhirWarning || `FHIR ID: ${fhirId}`,
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
    const row = db
      .prepare('SELECT * FROM PractitionerRoles WHERE Id = ?')
      .get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Practitioner role not found' });

    const name = displayName(row);
    let fhir = null;
    let fhirWarning = null;

    if (row.FhirId) {
      try {
        fhir = await deleteResource('PractitionerRole', row.FhirId);
      } catch (fhirErr) {
        fhirWarning = fhirErr.message;
      }
    }

    db.prepare('DELETE FROM PractitionerRoles WHERE Id = ?').run(row.Id);

    logActivity({
      eventType: 'PractitionerRole',
      entityName: name,
      actionText: fhirWarning ? 'Practitioner role deleted (FHIR warning)' : 'Practitioner role deleted',
      syncStatus: fhirWarning ? 'failed' : 'synced',
      details: fhirWarning || (row.FhirId ? `FHIR ID: ${row.FhirId}` : 'Local only'),
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
