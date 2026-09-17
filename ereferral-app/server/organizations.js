const express = require('express');
const { db } = require('./db');
const {
  putOrganization,
  updateOrganizationById,
  getOrganization,
  searchOrganizations,
  deleteResource,
  deduplicateOrganizations,
} = require('./fhir');
const { logActivity } = require('./activity');

const router = express.Router();
const TEAM_PREFIX = process.env.TEAM_PREFIX || 'TEAM07';

function mapOrganization(row) {
  if (!row) return null;
  return {
    id: row.Id,
    localCode: row.LocalCode,
    name: row.Name,
    nhfrCode: row.NhfrCode,
    hcpnCode: row.HcpnCode,
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
    fhirId: row.FhirId,
    syncStatus: row.SyncStatus,
    syncError: row.SyncError,
    syncedAt: row.SyncedAt,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
    source: 'local',
  };
}

function applyOrgFields(b) {
  return {
    Name: b.name,
    NhfrCode: b.nhfrCode,
    HcpnCode: b.hcpnCode || null,
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
  };
}

function orgRecency(o) {
  return Math.max(
    Date.parse(o.updatedAt || '') || 0,
    Date.parse(o.createdAt || '') || 0,
    Date.parse(o.syncedAt || '') || 0
  );
}

function sortOrganizationsNewestFirst(organizations) {
  return [...organizations].sort((a, b) => {
    // Prefer higher FHIR IDs (latest creates on CDR), then newest timestamps.
    const fhirB = Number(b.fhirId);
    const fhirA = Number(a.fhirId);
    const fb = Number.isFinite(fhirB) ? fhirB : -1;
    const fa = Number.isFinite(fhirA) ? fhirA : -1;
    if (fb !== fa) return fb - fa;
    const tb = orgRecency(b);
    const ta = orgRecency(a);
    if (tb !== ta) return tb - ta;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}

function matchesLocalOrgQuery(org, q) {
  if (!q) return true;
  const hay = [
    org.localCode,
    org.name,
    org.nhfrCode,
    org.hcpnCode,
    org.fhirId,
    org.phone,
    org.addressLine,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(String(q).toLowerCase());
}

function mergeOrgsWithLocal(fhirOrganizations, localOrganizations) {
  const byFhirId = new Map();
  const byNhfr = new Map();
  for (const local of localOrganizations) {
    if (local.fhirId) byFhirId.set(String(local.fhirId), local);
    if (local.nhfrCode && local.nhfrCode !== '-') {
      byNhfr.set(String(local.nhfrCode), local);
    }
  }

  const usedLocalIds = new Set();
  const merged = fhirOrganizations.map((fo) => {
    const local =
      (fo.fhirId && byFhirId.get(String(fo.fhirId))) ||
      (fo.nhfrCode && fo.nhfrCode !== '-' && byNhfr.get(String(fo.nhfrCode))) ||
      null;
    if (!local) return { ...fo, source: 'fhir' };
    usedLocalIds.add(local.id);
    return {
      ...fo,
      id: local.id,
      localCode:
        local.localCode && local.localCode !== '-' ? local.localCode : fo.localCode,
      syncStatus: local.syncStatus || fo.syncStatus || 'synced',
      syncError: local.syncError || null,
      // Prefer FHIR lastUpdated for recency so newest stay on top.
      syncedAt: fo.syncedAt || local.syncedAt || null,
      createdAt: fo.createdAt || local.createdAt || null,
      updatedAt: fo.updatedAt || local.updatedAt || null,
      source: 'fhir',
    };
  });

  const localOnly = localOrganizations
    .filter((local) => !usedLocalIds.has(local.id))
    .map((local) => ({ ...local, source: local.fhirId ? 'fhir' : 'local' }));

  return sortOrganizationsNewestFirst(deduplicateOrganizations([...localOnly, ...merged]));
}

function loadLocalOrganizations() {
  try {
    return db
      .prepare('SELECT * FROM Organizations ORDER BY datetime(CreatedAt) DESC')
      .all()
      .map(mapOrganization);
  } catch {
    return [];
  }
}

router.get('/', async (req, res) => {
  const sourcePref = String(req.query.source || 'fhir').toLowerCase();
  const forceLocal = sourcePref === 'local';
  const q = req.query.q ? String(req.query.q).trim() : '';
  const count = Math.min(500, Math.max(1, Number(req.query.count) || 200));
  const localOrganizations = loadLocalOrganizations();

  if (forceLocal) {
    let organizations = localOrganizations;
    if (q) organizations = organizations.filter((o) => matchesLocalOrgQuery(o, q));
    organizations = sortOrganizationsNewestFirst(organizations);
    return res.json({
      source: 'local',
      organizations,
      total: organizations.length,
      warning: null,
    });
  }

  try {
    const fhirOrganizations = await searchOrganizations({
      count,
      q: q || undefined,
      all: true,
      maxPages: 100,
    });
    let organizations = mergeOrgsWithLocal(fhirOrganizations, localOrganizations);
    if (q) organizations = organizations.filter((o) => matchesLocalOrgQuery(o, q));
    organizations = sortOrganizationsNewestFirst(organizations);

    return res.json({
      source: 'fhir',
      organizations,
      total: organizations.length,
      warning: `Loaded ${organizations.length} organization(s) from FHIR${
        localOrganizations.length ? ` (merged with ${localOrganizations.length} local)` : ''
      }.`,
    });
  } catch (err) {
    const detail = err.cause?.message || err.message || 'Unknown error';
    let organizations = localOrganizations;
    if (q) organizations = organizations.filter((o) => matchesLocalOrgQuery(o, q));
    organizations = sortOrganizationsNewestFirst(organizations);
    if (organizations.length) {
      return res.json({
        source: 'local',
        organizations,
        total: organizations.length,
        warning: `FHIR Organization API unavailable (${detail}). Showing ${organizations.length} local record(s).`,
      });
    }
    res.status(502).json({
      error: `Could not fetch organizations from FHIR API: ${detail}`,
    });
  }
});

router.get('/fhir/:fhirId', async (req, res) => {
  try {
    const organization = await getOrganization(req.params.fhirId);
    res.json(organization);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Organization not found' });
    res.json(mapOrganization(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const required = ['name', 'nhfrCode'];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  try {
    const nextNum = db.prepare('SELECT COUNT(*) AS c FROM Organizations').get().c + 1;
    const localCode = b.localCode || `${TEAM_PREFIX}-O${String(nextNum).padStart(4, '0')}`;
    const fields = applyOrgFields(b);

    const insert = db.prepare(`
      INSERT INTO Organizations (
        LocalCode, Name, NhfrCode, HcpnCode, Phone, AddressLine,
        RegionCode, RegionDisplay, ProvinceCode, ProvinceDisplay,
        CityCode, CityDisplay, BarangayCode, BarangayDisplay, PostalCode,
        SyncStatus
      ) VALUES (
        @LocalCode, @Name, @NhfrCode, @HcpnCode, @Phone, @AddressLine,
        @RegionCode, @RegionDisplay, @ProvinceCode, @ProvinceDisplay,
        @CityCode, @CityDisplay, @BarangayCode, @BarangayDisplay, @PostalCode,
        'pending'
      )
    `);

    const info = insert.run({
      LocalCode: localCode,
      ...fields,
    });

    let row = db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(info.lastInsertRowid);
    const displayName = `${row.Name} (${row.LocalCode})`;

    let fhirResult = null;
    try {
      fhirResult = await putOrganization(row);
      db.prepare(`
        UPDATE Organizations
        SET FhirId = @FhirId,
            SyncStatus = 'synced',
            SyncError = NULL,
            SyncedAt = datetime('now'),
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({ Id: row.Id, FhirId: fhirResult.fhirId });

      row = db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(row.Id);
      logActivity({
        eventType: 'Organization',
        entityName: displayName,
        actionText: 'Organization saved',
        syncStatus: 'synced',
        details: `FHIR ID: ${fhirResult.fhirId}`,
      });
    } catch (fhirErr) {
      db.prepare(`
        UPDATE Organizations
        SET SyncStatus = 'failed',
            SyncError = @SyncError,
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({ Id: row.Id, SyncError: fhirErr.message });

      row = db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(row.Id);
      logActivity({
        eventType: 'Organization',
        entityName: displayName,
        actionText: 'Organization saved (FHIR failed)',
        syncStatus: 'failed',
        details: String(fhirErr.message).slice(0, 480),
      });
    }

    res.status(201).json({
      organization: mapOrganization(row),
      fhir: fhirResult ? { id: fhirResult.fhirId, status: fhirResult.status } : null,
    });
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.toLowerCase().includes('unique')) {
      return res.status(409).json({
        error: 'Organization with this NHFR code or Local Code already exists locally.',
      });
    }
    res.status(500).json({ error: msg });
  }
});

router.put('/fhir/:fhirId', async (req, res) => {
  const b = req.body || {};
  const required = ['name', 'nhfrCode'];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  try {
    const fhirResult = await updateOrganizationById(req.params.fhirId, b);
    const organization = await getOrganization(req.params.fhirId);
    logActivity({
      eventType: 'Organization',
      entityName: b.name,
      actionText: 'Organization updated on FHIR',
      syncStatus: 'synced',
      details: `FHIR ID: ${req.params.fhirId}`,
    });
    res.json({ organization, fhir: { id: fhirResult.fhirId, status: fhirResult.status } });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const b = req.body || {};
  const required = ['name', 'nhfrCode'];
  const missing = required.filter((k) => !b[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  try {
    const existing = db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Organization not found' });

    const fields = applyOrgFields(b);
    db.prepare(`
      UPDATE Organizations SET
        Name = @Name,
        NhfrCode = @NhfrCode,
        HcpnCode = @HcpnCode,
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
        UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({ Id: existing.Id, ...fields });

    let row = db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(existing.Id);
    const displayName = `${row.Name} (${row.LocalCode})`;

    let fhirResult = null;
    try {
      if (row.FhirId) {
        fhirResult = await updateOrganizationById(row.FhirId, row);
      } else {
        fhirResult = await putOrganization(row);
      }
      db.prepare(`
        UPDATE Organizations
        SET FhirId = @FhirId,
            SyncStatus = 'synced',
            SyncError = NULL,
            SyncedAt = datetime('now'),
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({ Id: row.Id, FhirId: fhirResult.fhirId });

      row = db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(row.Id);
      logActivity({
        eventType: 'Organization',
        entityName: displayName,
        actionText: 'Organization updated',
        syncStatus: 'synced',
        details: `FHIR ID: ${fhirResult.fhirId}`,
      });
    } catch (fhirErr) {
      db.prepare(`
        UPDATE Organizations
        SET SyncStatus = 'failed',
            SyncError = @SyncError,
            UpdatedAt = datetime('now')
        WHERE Id = @Id
      `).run({ Id: row.Id, SyncError: fhirErr.message });

      row = db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(row.Id);
      logActivity({
        eventType: 'Organization',
        entityName: displayName,
        actionText: 'Organization updated (FHIR failed)',
        syncStatus: 'failed',
        details: String(fhirErr.message).slice(0, 480),
      });
    }

    res.json({
      organization: mapOrganization(row),
      fhir: fhirResult ? { id: fhirResult.fhirId, status: fhirResult.status } : null,
    });
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.toLowerCase().includes('unique')) {
      return res.status(409).json({
        error: 'Organization with this NHFR code or Local Code already exists locally.',
      });
    }
    res.status(500).json({ error: msg });
  }
});

router.post('/:id/sync', async (req, res) => {
  try {
    let row = db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Organization not found' });

    const displayName = `${row.Name} (${row.LocalCode})`;
    const fhirResult = row.FhirId
      ? await updateOrganizationById(row.FhirId, row)
      : await putOrganization(row);

    db.prepare(`
      UPDATE Organizations
      SET FhirId = @FhirId,
          SyncStatus = 'synced',
          SyncError = NULL,
          SyncedAt = datetime('now'),
          UpdatedAt = datetime('now')
      WHERE Id = @Id
    `).run({ Id: row.Id, FhirId: fhirResult.fhirId });

    row = db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(row.Id);
    logActivity({
      eventType: 'Organization',
      entityName: displayName,
      actionText: 'Organization re-synced',
      syncStatus: 'synced',
      details: `FHIR ID: ${fhirResult.fhirId}`,
    });

    res.json({
      organization: mapOrganization(row),
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
    const local = db.prepare('SELECT * FROM Organizations WHERE FhirId = ?').get(fhirId);
    if (local) {
      db.prepare('DELETE FROM Organizations WHERE Id = ?').run(local.Id);
    }

    let fhir = null;
    let fhirWarning = null;
    try {
      fhir = await deleteResource('Organization', fhirId);
    } catch (fhirErr) {
      fhirWarning = fhirErr.message;
    }

    const displayName = local ? `${local.Name} (${local.LocalCode})` : `Organization/${fhirId}`;
    logActivity({
      eventType: 'Organization',
      entityName: displayName,
      actionText: fhirWarning ? 'Organization deleted (FHIR warning)' : 'Organization deleted',
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
    const row = db.prepare('SELECT * FROM Organizations WHERE Id = ?').get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Organization not found' });

    const displayName = `${row.Name} (${row.LocalCode})`;
    let fhir = null;
    let fhirWarning = null;

    if (row.FhirId) {
      try {
        fhir = await deleteResource('Organization', row.FhirId);
      } catch (fhirErr) {
        fhirWarning = fhirErr.message;
      }
    }

    db.prepare('DELETE FROM Organizations WHERE Id = ?').run(row.Id);

    logActivity({
      eventType: 'Organization',
      entityName: displayName,
      actionText: fhirWarning ? 'Organization deleted (FHIR warning)' : 'Organization deleted',
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
