require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const {
  checkDb,
  dbPath,
  getDefaultFacilityConfig,
  USE_PERSISTENT_LOCAL_DB,
  TEAM_PREFIX,
} = require('./db');
const { checkFhir, FHIR_BASE_URL } = require('./fhir');
const { checkTx, TX_BASE_URL, PSGC_SYSTEM } = require('./psgc');
const patientsRouter = require('./patients');
const organizationsRouter = require('./organizations');
const practitionersRouter = require('./practitioners');
const practitionerRolesRouter = require('./practitioner-roles');
const referralsRouter = require('./referrals');
const incomingRouter = require('./incoming');
const psgcRouter = require('./psgc-routes');
const { pullPatientsFromFhir, pushPendingToFhir } = require('./sync');
const { initRealtime, getConnectionCount, broadcast: emit } = require('./realtime');
const { getDashboardSnapshot, getDashboardSnapshotAsync, publishDashboard } = require('./activity');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;

initRealtime(server);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', async (_req, res) => {
  const defaultFacility = getDefaultFacilityConfig();
  const health = {
    localDb: { status: 'disconnected', message: null, engine: 'sqlite', path: dbPath },
    fhir: { status: 'disconnected', message: null, baseUrl: FHIR_BASE_URL },
    terminology: {
      status: 'disconnected',
      message: null,
      baseUrl: TX_BASE_URL,
      system: PSGC_SYSTEM,
    },
    realtime: {
      status: 'connected',
      connections: getConnectionCount(),
    },
    teamPrefix: TEAM_PREFIX,
    defaultFacility: defaultFacility
      ? {
          fhirId: defaultFacility.fhirId,
          name: defaultFacility.name,
          nhfrCode: defaultFacility.nhfrCode,
        }
      : null,
    checkedAt: new Date().toISOString(),
  };

  try {
    if (!USE_PERSISTENT_LOCAL_DB) {
      health.localDb.status = 'disabled';
      health.localDb.message =
        'Persistent local SQLite temporarily disabled. App uses FHIR live + in-memory scratch only.';
      health.localDb.path = ':memory:';
    } else {
      checkDb();
      health.localDb.status = 'connected';
    }
  } catch (err) {
    health.localDb.message = err.message;
  }

  try {
    await checkFhir();
    health.fhir.status = 'connected';
  } catch (err) {
    health.fhir.message = err.message;
  }

  try {
    const tx = await checkTx();
    health.terminology = { ...health.terminology, ...tx };
  } catch (err) {
    health.terminology.message = err.message;
  }

  res.json(health);
});

app.get('/api/dashboard', async (_req, res) => {
  try {
    res.json(await getDashboardSnapshotAsync({ forceFhir: true }));
  } catch (err) {
    try {
      res.json(getDashboardSnapshot());
    } catch (fallbackErr) {
      res.status(500).json({ error: err.message || fallbackErr.message });
    }
  }
});

app.use('/api/patients', patientsRouter);
app.use('/api/organizations', organizationsRouter);
app.use('/api/practitioners', practitionersRouter);
app.use('/api/practitioner-roles', practitionerRolesRouter);
app.use('/api/referrals', referralsRouter);
app.use('/api/incoming', incomingRouter);
app.use('/api/psgc', psgcRouter);

app.post('/api/sync/pull', async (req, res) => {
  // Persistent local DB temporarily disabled - do not pull FHIR into SQLite.
  if (!USE_PERSISTENT_LOCAL_DB) {
    return res.status(503).json({
      error:
        'Local DB sync is temporarily disabled. Incoming/patients load live from FHIR instead.',
      disabled: true,
    });
  }
  try {
    const teamOnly = String(req.body?.teamOnly ?? 'true').toLowerCase() !== 'false';
    const count = Math.min(200, Math.max(1, Number(req.body?.count) || 100));
    const q = req.body?.q ? String(req.body.q).trim() : undefined;
    const result = await pullPatientsFromFhir({ teamOnly, count, q });
    emit('syncCompleted', { kind: 'pull', ...result });
    publishDashboard();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/push', async (_req, res) => {
  // Persistent local DB temporarily disabled - nothing to push from SQLite.
  if (!USE_PERSISTENT_LOCAL_DB) {
    return res.status(503).json({
      error: 'Local DB sync is temporarily disabled. Create/update flows post directly to FHIR.',
      disabled: true,
    });
  }
  try {
    const result = await pushPendingToFhir();
    emit('syncCompleted', { kind: 'push', ...result });
    publishDashboard();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`eReferral app running at http://localhost:${PORT}`);
  console.log(`Realtime hub: ws://localhost:${PORT}/socket.io`);
  if (USE_PERSISTENT_LOCAL_DB) {
    console.log(`Local DB (SQLite): ${dbPath}`);
  } else {
    console.log('Local DB: disabled (in-memory scratch only; FHIR is source of truth)');
  }
  console.log(`FHIR base: ${FHIR_BASE_URL}`);
});
