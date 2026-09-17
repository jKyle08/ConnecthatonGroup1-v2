const express = require('express');
const {
  lookupCode,
  searchConcepts,
  searchDiagnoses,
  searchPractitionerRoles,
  listPractitionerRoles,
  listReferralCategories,
  getChildren,
  listRegions,
  toOption,
  PSGC_SYSTEM,
  PSGC_RELEASE,
  SNOMED_SYSTEM,
  PRACTITIONER_ROLE_VS,
  REFERRAL_CATEGORY_VS,
  TX_BASE_URL,
} = require('./psgc');

const router = express.Router();

router.get('/regions', (req, res) => {
  try {
    const q = String(req.query.q || req.query.term || '').trim();
    const results = listRegions(q);
    res.json({
      system: PSGC_SYSTEM,
      version: PSGC_RELEASE,
      release: PSGC_RELEASE,
      source: 'https://psa.gov.ph/classification/psgc',
      q,
      count: results.length,
      results,
      resultsSelect2: results.map((r) => ({ id: r.id, text: r.text })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/diagnoses', async (req, res) => {
  try {
    const q = String(req.query.q || req.query.term || '').trim();
    const count = Number(req.query.count) || 20;
    const results = await searchDiagnoses(q, count);
    res.json({
      system: SNOMED_SYSTEM,
      q,
      results,
      resultsSelect2: results.map((r) => ({
        id: r.id,
        text: r.text || r.display,
        code: r.code,
        display: r.display,
        system: r.system,
        snomedCode: r.snomedCode || r.code,
        icdCode: r.icdCode || null,
        icdDisplay: r.icdDisplay || null,
      })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/practitioner-roles', async (req, res) => {
  try {
    const q = String(req.query.q || req.query.term || '').trim();
    const count = Number(req.query.count) || 25;
    const data = q
      ? await searchPractitionerRoles(q, count)
      : await listPractitionerRoles();
    res.json({
      system: SNOMED_SYSTEM,
      valueSet: data.valueSet || PRACTITIONER_ROLE_VS,
      source: data.source,
      q,
      total: data.total,
      results: data.results,
      resultsSelect2: data.results.map((r) => ({
        id: r.id || `${r.code}|${r.display}`,
        text: r.display,
        code: r.code,
        display: r.display,
        system: r.system || SNOMED_SYSTEM,
        suggested: Boolean(r.suggested),
      })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/referral-categories', async (_req, res) => {
  try {
    const data = await listReferralCategories();
    res.json({
      system: SNOMED_SYSTEM,
      valueSet: data.valueSet || REFERRAL_CATEGORY_VS,
      source: data.source,
      total: data.total,
      results: data.results,
      resultsSelect2: data.results.map((r) => ({
        id: r.code,
        text: r.display,
        code: r.code,
        display: r.display,
        system: r.system || SNOMED_SYSTEM,
      })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || req.query.term || '').trim();
    const count = Number(req.query.count) || 20;
    const results = await searchConcepts(q, count);
    res.json({
      system: PSGC_SYSTEM,
      q,
      results,
      // Select2 ajax shape
      resultsSelect2: results.map((r) => ({ id: r.id, text: r.text })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/children', async (req, res) => {
  try {
    const parent = String(req.query.parent || '').trim();
    if (!parent) {
      return res.status(400).json({ error: 'parent query parameter is required' });
    }
    const data = await getChildren(parent);
    res.json({
      system: PSGC_SYSTEM,
      parent: data.parent,
      results: data.results,
      resultsSelect2: data.results.map((r) => ({ id: r.id, text: r.text })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/lookup', async (req, res) => {
  try {
    const code = String(req.query.code || '').trim();
    if (!code) {
      return res.status(400).json({ error: 'code query parameter is required' });
    }
    const item = await lookupCode(code);
    const option = toOption(item.code || code, item.display);
    res.json({
      system: PSGC_SYSTEM,
      ...option,
      children: item.children,
      inactive: item.inactive,
      version: item.version,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/meta', (_req, res) => {
  res.json({
    system: PSGC_SYSTEM,
    version: PSGC_RELEASE,
    release: PSGC_RELEASE,
    diagnosisSystem: SNOMED_SYSTEM,
    practitionerRoleValueSet: PRACTITIONER_ROLE_VS,
    referralCategoryValueSet: REFERRAL_CATEGORY_VS,
    terminologyBase: TX_BASE_URL,
    endpoints: {
      regions: '/api/psgc/regions',
      search: '/api/psgc/search?q=',
      diagnoses: '/api/psgc/diagnoses?q=',
      practitionerRoles: '/api/psgc/practitioner-roles',
      referralCategories: '/api/psgc/referral-categories',
      children: '/api/psgc/children?parent=',
      lookup: '/api/psgc/lookup?code=',
    },
  });
});

module.exports = router;
