const state = {
  health: null,
  dashboard: null,
  patients: {
    page: 1,
    pageSize: 10,
    q: '',
    total: 0,
    totalPages: 1,
    source: 'fhir',
    items: [],
    /** Recently saved patients kept briefly so FHIR search lag does not hide them. */
    recentCreates: [],
  },
  organizations: {
    page: 1,
    pageSize: 10,
    q: '',
    total: 0,
    totalPages: 1,
    source: 'fhir',
    items: [],
  },
  practitioners: {
    page: 1,
    pageSize: 10,
    q: '',
    total: 0,
    totalPages: 1,
    source: 'fhir',
    items: [],
    recentCreates: [],
  },
  practitionerRoles: {
    page: 1,
    pageSize: 10,
    q: '',
    total: 0,
    totalPages: 1,
    source: 'fhir',
    items: [],
    recentCreates: [],
    lookups: {
      practitioners: [],
      organizations: [],
      roleCodes: [],
      loaded: false,
    },
  },
  referrals: {
    q: '',
    total: 0,
  },
  inbox: {
    page: 1,
    pageSize: 10,
    q: '',
    total: 0,
    totalPages: 1,
    status: 'all',
    source: 'fhir',
    receivingOrgFhirId: null,
    facilitiesLoaded: false,
    suppressFacilityChange: false,
    pollTimer: null,
    loading: false,
    requestId: 0,
    cache: [],
    cacheAt: null,
  },
  referralLookups: {
    patients: [],
    patientsLoaded: false,
    patientsLoading: false,
    organizations: [],
    practitioners: [],
    practitionerRoles: [],
    rolesWarnShown: false,
  },
  transferLookups: {
    organizations: [],
    practitionerRoles: [],
    loaded: false,
    loading: false,
  },
  formMode: 'create', // create | edit
  orgFormMode: 'create', // create | edit
  pracFormMode: 'create', // create | edit
  roleFormMode: 'create', // create | edit
  progressAbort: null,
  activeReferralView: {
    taskFhirId: null,
    localId: null,
  },
  recordView: {
    entity: null,
    fhirId: null,
    historyLoaded: false,
    historyLoading: false,
  },
};

function $(sel) {
  return document.querySelector(sel);
}

async function parseResponseJson(res, urlHint = '') {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const looksHtml = /^\s*</.test(text);
    throw new Error(
      looksHtml
        ? `API returned HTML instead of JSON${urlHint ? ` (${urlHint})` : ''}. Restart the Node server so new routes are loaded.`
        : `Invalid JSON response${urlHint ? ` from ${urlHint}` : ''}`
    );
  }
}

const TOASTR_ICONS = {
  ok: '<svg class="toastr-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 16.2 5.8 12.5l1.4-1.4 2.3 2.3 6.3-6.3 1.4 1.4-7.7 7.7Z"/></svg>',
  success: '<svg class="toastr-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 16.2 5.8 12.5l1.4-1.4 2.3 2.3 6.3-6.3 1.4 1.4-7.7 7.7Z"/></svg>',
  err: '<svg class="toastr-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Zm1 13h-2v-2h2v2Zm0-4h-2V7h2v5Z"/></svg>',
  error: '<svg class="toastr-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Zm1 13h-2v-2h2v2Zm0-4h-2V7h2v5Z"/></svg>',
  warn: '<svg class="toastr-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2 20h20L12 4Zm1 13h-2v-2h2v2Zm0-4h-2v-4h2v4Z"/></svg>',
  warning: '<svg class="toastr-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2 20h20L12 4Zm1 13h-2v-2h2v2Zm0-4h-2v-4h2v4Z"/></svg>',
  info: '<svg class="toastr-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Zm1 14h-2v-6h2v6Zm0-8h-2V7h2v2Z"/></svg>',
};

const TOASTR_TITLES = {
  ok: 'Success',
  success: 'Success',
  err: 'Error',
  error: 'Error',
  warn: 'Warning',
  warning: 'Warning',
  info: 'Notice',
};

function showToast(message, type = 'ok', options = {}) {
  const container = $('#toastrContainer');
  if (!container || !message) return;

  const kind = type === 'error' ? 'err' : type === 'success' ? 'ok' : type;
  const title = options.title || TOASTR_TITLES[kind] || TOASTR_TITLES.info;
  const duration = options.duration ?? (kind === 'err' || kind === 'error' ? 5600 : 4200);

  const el = document.createElement('div');
  el.className = `toastr ${kind}`;
  el.setAttribute('role', kind === 'err' || kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `
    ${TOASTR_ICONS[kind] || TOASTR_ICONS.info}
    <div class="toastr-body">
      <p class="toastr-title">${escapeHtml(title)}</p>
      <p class="toastr-message">${escapeHtml(message)}</p>
    </div>
    <button class="toastr-close" type="button" aria-label="Dismiss">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 6.4 12 12l5.6-5.6 1.4 1.4L13.4 13.4l5.6 5.6-1.4 1.4L12 14.8l-5.6 5.6-1.4-1.4 5.6-5.6L5 7.8l1.4-1.4Z"/></svg>
    </button>
  `;

  const dismiss = () => {
    if (el.classList.contains('hiding')) return;
    el.classList.add('hiding');
    setTimeout(() => el.remove(), 200);
  };

  el.querySelector('.toastr-close').addEventListener('click', dismiss);
  container.appendChild(el);

  const timer = setTimeout(dismiss, duration);
  el.addEventListener('mouseenter', () => clearTimeout(timer), { once: true });
}

function fieldLabel(el) {
  const label = el.closest('label');
  if (label) {
    const text = Array.from(label.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent.trim())
      .join(' ')
      .replace(/\*$/, '')
      .trim();
    if (text) return text;
  }
  return el.getAttribute('aria-label') || el.name || 'This field';
}

function validateForm(form) {
  if (form.checkValidity()) return true;

  const invalid = [...form.querySelectorAll(':invalid')];
  const first = invalid[0];
  const missing = invalid.filter((el) => el.validity.valueMissing);
  const message =
    missing.length > 1
      ? `Please complete ${missing.length} required fields.`
      : first?.validationMessage || `${fieldLabel(first)} is required.`;

  showToast(message, 'err', { title: 'Validation' });
  first?.focus?.();
  return false;
}

function showProgressModal({
  title = 'Saving...',
  message = 'Please wait...',
  steps = [],
  cancellable = false,
} = {}) {
  const modal = $('#progressModal');
  if (!modal) return;

  $('#progressTitle').textContent = title;
  $('#progressMessage').textContent = message;
  $('#progressBarFill').style.width = steps.length ? '12%' : '28%';

  const list = $('#progressSteps');
  if (steps.length) {
    list.hidden = false;
    list.innerHTML = steps
      .map(
        (step, i) =>
          `<li data-step="${i}" class="${i === 0 ? 'active' : ''}"><span class="step-dot"></span>${escapeHtml(step)}</li>`
      )
      .join('');
  } else {
    list.hidden = true;
    list.innerHTML = '';
  }

  const actions = $('#progressActions');
  const cancelBtn = $('#progressCancelBtn');
  if (actions) actions.hidden = !cancellable;
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Cancel';
  }

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function setProgressStep(index, status = 'active') {
  const list = $('#progressSteps');
  if (!list || list.hidden) return;

  const items = [...list.querySelectorAll('li')];
  items.forEach((li, i) => {
    li.classList.remove('active', 'done', 'err');
    if (i < index) {
      li.classList.add('done');
    } else if (i === index) {
      if (status === 'err') li.classList.add('err');
      else if (status === 'done') li.classList.add('done');
      else li.classList.add('active');
    }
  });

  const fill = $('#progressBarFill');
  if (fill && items.length) {
    let pct;
    if (status === 'done') pct = Math.round(((index + 1) / items.length) * 100);
    else if (status === 'err') pct = Math.round(((index + 0.55) / items.length) * 100);
    else pct = Math.round(((index + 0.45) / items.length) * 100);
    fill.style.width = `${Math.min(100, pct)}%`;
  }
}

function setProgressMessage(text) {
  const el = $('#progressMessage');
  if (el) el.textContent = text;
}

function paintProgress() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

async function runSaveWithFhirProgress({ title, entityLabel = 'record' }, work) {
  return withProgress(
    {
      title,
      message: 'Syncing to FHIR server...',
      steps: ['Validate form', 'Sync to FHIR server'],
    },
    async ({ setProgressStep, completeProgressModal }) => {
      setProgressStep(0, 'done');
      setProgressStep(1, 'active');
      setProgressMessage(`Syncing ${entityLabel} to FHIR server...`);
      await paintProgress();

      return work({ setProgressStep, completeProgressModal, setProgressMessage });
    }
  );
}

function completeProgressModal(success = true) {
  const list = $('#progressSteps');
  if (list && !list.hidden) {
    list.querySelectorAll('li').forEach((li) => {
      if (success) {
        if (!li.classList.contains('err')) {
          li.classList.remove('active');
          li.classList.add('done');
        }
      } else if (li.classList.contains('active')) {
        li.classList.remove('active');
        li.classList.add('err');
      }
    });
  }
  const fill = $('#progressBarFill');
  if (fill && success) fill.style.width = '100%';
  const cancelBtn = $('#progressCancelBtn');
  if (cancelBtn) cancelBtn.disabled = true;
  const actions = $('#progressActions');
  if (actions) actions.hidden = true;
}

function hideProgressModal() {
  const modal = $('#progressModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  $('#progressSteps').innerHTML = '';
  $('#progressBarFill').style.width = '18%';
  const actions = $('#progressActions');
  const cancelBtn = $('#progressCancelBtn');
  if (actions) actions.hidden = true;
  if (cancelBtn) {
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Cancel';
  }
}

function isAbortError(err, signal) {
  if (signal?.aborted) return true;
  return err?.name === 'AbortError' || err?.code === 'ABORT_ERR';
}

async function withProgress(options, work) {
  const controller = new AbortController();
  state.progressAbort = controller;
  showProgressModal({
    ...options,
    cancellable: Boolean(options?.cancellable),
  });
  try {
    const result = await work({
      setProgressStep,
      completeProgressModal,
      signal: controller.signal,
      isCancelled: () => controller.signal.aborted,
    });
    if (controller.signal.aborted) {
      throw new DOMException('Cancelled', 'AbortError');
    }
    await new Promise((r) => setTimeout(r, 420));
    return result;
  } catch (err) {
    if (isAbortError(err, controller.signal)) {
      completeProgressModal(false);
      await new Promise((r) => setTimeout(r, 180));
      showToast(options?.cancelMessage || 'Operation cancelled.', 'warn', {
        title: 'Cancelled',
      });
      return null;
    }
    completeProgressModal(false);
    const msg = $('#progressMessage');
    if (msg) msg.textContent = err.message || 'Something went wrong.';
    const actions = $('#progressActions');
    const cancelBtn = $('#progressCancelBtn');
    if (actions) actions.hidden = false;
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Close';
    }
    await new Promise((r) => setTimeout(r, 900));
    throw err;
  } finally {
    if (state.progressAbort === controller) state.progressAbort = null;
    hideProgressModal();
  }
}

function closeAllNavDropdowns() {
  document.querySelectorAll('#mainNav .nav-dd.open').forEach((dd) => {
    dd.classList.remove('open');
    const trigger = dd.querySelector('.nav-dd-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  });
}

function setInboxBadgeCount(count) {
  const value = String(count || 0);
  const show = Number(count) > 0;
  ['#inboxBadge', '#inboxBadgeMenu'].forEach((sel) => {
    const el = $(sel);
    if (!el) return;
    el.textContent = value;
    el.hidden = !show;
  });
}

function setView(view) {
  const target = document.getElementById(`view-${view}`);
  if (!target) return;

  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  target.classList.add('active');

  document.querySelectorAll('#mainNav [data-view]').forEach((btn) => {
    btn.classList.toggle(
      'active',
      btn.dataset.view === view ||
        (view === 'patient-form' && btn.dataset.view === 'patients') ||
        (view === 'organization-form' && btn.dataset.view === 'organizations') ||
        (view === 'practitioner-form' && btn.dataset.view === 'practitioners') ||
        (view === 'practitioner-role-form' && btn.dataset.view === 'practitioner-roles')
    );
  });

  document.querySelectorAll('#mainNav .nav-dd').forEach((dd) => {
    const childActive = [...dd.querySelectorAll('[data-view]')].some((btn) =>
      btn.classList.contains('active')
    );
    dd.classList.toggle('active', childActive);
  });

  closeAllNavDropdowns();

  const statusPills = document.querySelector('.status-pills');
  if (statusPills) statusPills.hidden = view === 'patient-form';
  document.querySelector('.app-header')?.classList.toggle('app-header-compact', view === 'patient-form');

  try {
    sessionStorage.setItem('ereferral.activeView', view);
  } catch {
    /* ignore */
  }
  if (location.hash.slice(1) !== view) {
    history.replaceState(null, '', `#${view}`);
  }

  if (view === 'dashboard') loadDashboard();
  if (view === 'patients') {
    loadPatients({ silent: (state.patients.items || []).length > 0 });
  }
  if (view === 'organizations') loadOrganizations({ source: 'fhir' });
  if (view === 'practitioners') {
    loadPractitioners({
      source: 'fhir',
      silent: (state.practitioners.items || []).length > 0,
    });
  }
  if (view === 'practitioner-roles') {
    loadPractitionerRoles({
      source: 'fhir',
      silent: (state.practitionerRoles.items || []).length > 0,
    });
  }
  if (view === 'sync') renderSyncMonitor();
  if (view === 'new-referral') prepareReferralForm();
  if (view === 'sent') loadSentReferrals();
  if (view === 'inbox') {
    loadInboxReferrals();
    startInboxAutoRefresh();
  } else {
    stopInboxAutoRefresh();
  }
  if (view === 'patient-form' && state.formMode === 'create') {
    resetPatientForm();
  }
  if (view === 'organization-form' && state.orgFormMode === 'create') {
    resetOrganizationForm();
  } else if (view === 'organization-form') {
    const form = $('#organizationForm');
    if (form && !form.dataset.seeded && state.orgFormMode === 'create') {
      seedOrganizationIds(form);
      form.dataset.seeded = '1';
    }
  }
  if (view === 'practitioner-form' && state.pracFormMode === 'create') {
    resetPractitionerForm();
  } else if (view === 'practitioner-form') {
    const form = $('#practitionerForm');
    if (form && !form.dataset.seeded && state.pracFormMode === 'create') {
      seedPractitionerIds(form);
      form.dataset.seeded = '1';
    }
  }
  if (view === 'practitioner-role-form' && state.roleFormMode === 'create') {
    resetPractitionerRoleForm();
  }
}

function getInitialView() {
  const fromHash = (location.hash || '').replace(/^#/, '').trim();
  let fromStore = '';
  try {
    fromStore = sessionStorage.getItem('ereferral.activeView') || '';
  } catch {
    fromStore = '';
  }
  const candidate = fromHash || fromStore || 'dashboard';
  return document.getElementById(`view-${candidate}`) ? candidate : 'dashboard';
}

function seedUniqueIds(form) {
  const stamp = Date.now().toString().slice(-6);
  form.philsysId.value = `1207-TEAM07-${stamp}`;
  form.philhealthId.value = `12-T07${stamp.slice(-5)}-1`;
  if (window.PsgcSelect) {
    PsgcSelect.resetForm('#patientForm', {
      regionCode: PsgcSelect.DEFAULT_REGION.code,
      regionDisplay: PsgcSelect.DEFAULT_REGION.display,
    });
  } else {
    form.regionCode.value = '1200000000';
    form.regionDisplay.value = 'Region XII (SOCCSKSARGEN)';
  }
}

function seedOrganizationIds(form) {
  const stamp = Date.now().toString().slice(-6);
  form.nhfrCode.value = `TEAM07-NHFR-${stamp}`;
  form.hcpnCode.value = 'Regional HCPN';
  if (window.PsgcSelect) {
    PsgcSelect.resetForm('#organizationForm', {
      regionCode: PsgcSelect.DEFAULT_REGION.code,
      regionDisplay: PsgcSelect.DEFAULT_REGION.display,
    });
  } else {
    form.regionCode.value = '1200000000';
    form.regionDisplay.value = 'Region XII (SOCCSKSARGEN)';
  }
}

function seedPractitionerIds(form) {
  const stamp = Date.now().toString().slice(-6);
  form.prcId.value = `TEAM07-${stamp}`;
  form.prefix.value = 'Dr.';
  if (form.roleCode) form.roleCode.value = '158965000';
  if (form.roleDisplay) form.roleDisplay.value = 'Doctor';
  if (form.roleSystem) form.roleSystem.value = 'http://snomed.info/sct';
}

function setSaveButtonLabel(btn, label = 'Save') {
  if (!btn) return;
  btn.textContent = label;
}

function resetPatientForm() {
  const form = $('#patientForm');
  if (!form) return;
  form.reset();
  syncSearchableSelect(form.gender);
  state.formMode = 'create';
  $('#patientEditId').value = '';
  $('#patientEditFhirId').value = '';
  $('#patientFormTitle').textContent = 'Register Patient';
  $('#patientFormSubtitle').textContent = 'Saved locally, then synced to FHIR';
  $('#patientFormAlert').hidden = false;
  $('#savePatientBtn').hidden = false;
  setSaveButtonLabel($('#savePatientBtn'), 'Save');
  setFormReadonly(false);
  seedUniqueIds(form);
}

function setFormReadonly(readonly) {
  const form = $('#patientForm');
  [...form.elements].forEach((el) => {
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
    if (el.classList?.contains('psgc-select')) return;
    el.disabled = readonly;
    if (el.tagName === 'SELECT') syncSearchableSelect(el);
  });
  if (window.PsgcSelect) PsgcSelect.setReadonly('#patientForm', readonly);
}

function fillPatientForm(p) {
  const form = $('#patientForm');
  const fields = [
    'philsysId',
    'philhealthId',
    'familyName',
    'givenName1',
    'givenName2',
    'gender',
    'birthDate',
    'phone',
    'addressLine',
    'postalCode',
    'nextOfKinFamily',
    'nextOfKinGiven',
  ];
  fields.forEach((name) => {
    if (form[name]) form[name].value = p[name] || '';
  });
  syncSearchableSelect(form.gender);
  $('#patientEditId').value = p.id || '';
  $('#patientEditFhirId').value = p.fhirId || '';
  if (window.PsgcSelect) {
    PsgcSelect.setFormValues('#patientForm', {
      regionCode: p.regionCode,
      regionDisplay: p.regionDisplay,
      provinceCode: p.provinceCode,
      provinceDisplay: p.provinceDisplay,
      cityCode: p.cityCode,
      cityDisplay: p.cityDisplay,
      barangayCode: p.barangayCode,
      barangayDisplay: p.barangayDisplay,
    });
  } else {
    [
      'regionCode',
      'regionDisplay',
      'provinceCode',
      'provinceDisplay',
      'cityCode',
      'cityDisplay',
      'barangayCode',
      'barangayDisplay',
    ].forEach((name) => {
      if (form[name]) form[name].value = p[name] || '';
    });
  }
}

function syncDot(el, status) {
  if (!el) return;
  el.classList.remove('ok', 'warn', 'err');
  if (status === 'connected') el.classList.add('ok');
  else if (status === 'checking') el.classList.add('warn');
  else el.classList.add('err');
}

function setLiveStatus(status, label) {
  const text = $('#liveStatus');
  if (text) text.textContent = label;
  syncDot($('#liveDot'), status);
}

function getActiveFacility() {
  const saved = localStorage.getItem('ereferral_active_facility');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && (parsed.fhirId || parsed.id || parsed.name)) {
        return parsed;
      }
    } catch {}
  }
  return state.health?.defaultFacility || null;
}

function defaultFacilityFhirId() {
  const active = getActiveFacility();
  return String(active?.fhirId || active?.id || '').trim();
}

function syncActiveFacilityUi() {
  const active = getActiveFacility();
  const facilityName = active?.name || state.health?.defaultFacility?.name || 'Connectathon Facility';
  if ($('#teamLabel')) {
    $('#teamLabel').textContent = facilityName;
  }
  if ($('#teamChip')) {
    const code = active?.nhfrCode ? `NHFR: ${active.nhfrCode}` : (state.health?.teamPrefix ? `${state.health.teamPrefix}` : 'Switch Facility');
    $('#teamChip').textContent = `${code} ▾`;
  }
}

function setActiveFacility(facility) {
  if (!facility) return;
  const toSave = {
    fhirId: facility.fhirId || facility.id,
    id: facility.id || facility.fhirId,
    name: facility.name || 'Unknown Facility',
    nhfrCode: facility.nhfrCode || facility.localCode || '',
    city: facility.city || facility.cityMunicipality || '',
    province: facility.province || '',
  };
  localStorage.setItem('ereferral_active_facility', JSON.stringify(toSave));
  if (state.health) {
    state.health.defaultFacility = {
      ...(state.health.defaultFacility || {}),
      ...toSave,
    };
  }
  syncActiveFacilityUi();
  closeFacilitySwitcherModal();
  if (typeof showToast === 'function') {
    showToast(`Active facility set to: ${toSave.name}`, 'ok');
  }

  // Update quick form / main form facility dropdowns if present
  const quickOrg = $('#practitionerQuickOrgSelect');
  if (quickOrg) populateFacilityDropdown(quickOrg, defaultFacilityFhirId());
  const formOrg = $('#practitionerFormOrgSelect');
  if (formOrg) populateFacilityDropdown(formOrg, defaultFacilityFhirId());
}

let allFacilitiesCache = [];

async function loadAllFacilitiesForSwitcher() {
  if (allFacilitiesCache.length) return allFacilitiesCache;
  try {
    const res = await fetch('/api/organizations?source=fhir&count=200');
    const data = await res.json();
    const orgs = (data.organizations || []).map((o) => ({
      id: o.id || o.fhirId,
      fhirId: o.fhirId || o.id,
      name: o.name || 'Unnamed Facility',
      nhfrCode: o.nhfrCode || o.localCode || '',
      city: o.city || o.cityMunicipality || '',
      province: o.province || '',
    }));
    allFacilitiesCache = orgs;
    return orgs;
  } catch {
    return [];
  }
}

function renderFacilityPickerList(facilities, query = '') {
  const container = $('#facilityPickerList');
  if (!container) return;
  const currentActiveId = defaultFacilityFhirId();
  const q = String(query || '').trim().toLowerCase();

  const filtered = (facilities || []).filter((f) => {
    if (!q) return true;
    return (
      (f.name || '').toLowerCase().includes(q) ||
      (f.nhfrCode || '').toLowerCase().includes(q) ||
      (f.city || '').toLowerCase().includes(q) ||
      (f.province || '').toLowerCase().includes(q) ||
      (f.fhirId || '').toLowerCase().includes(q)
    );
  });

  if (!filtered.length) {
    container.innerHTML = `<p class="placeholder" style="padding: 1.5rem; text-align: center;">No facilities found matching "${escapeHtml(q)}"</p>`;
    return;
  }

  container.innerHTML = filtered
    .map((f) => {
      const isActive = String(f.fhirId || f.id) === String(currentActiveId);
      const activeClass = isActive ? 'is-active' : '';
      const location = [f.city, f.province].filter(Boolean).join(', ');
      return `
        <button type="button" class="facility-card-item ${activeClass}" data-facility-id="${escapeHtml(f.fhirId || f.id)}">
          <div class="fac-meta-left">
            <div class="fac-meta-title">${escapeHtml(f.name)}</div>
            <div class="fac-meta-details">
              ${f.nhfrCode ? `<span class="fac-badge">NHFR: ${escapeHtml(f.nhfrCode)}</span>` : ''}
              ${location ? `<span>📍 ${escapeHtml(location)}</span>` : ''}
              <span class="muted">ID: ${escapeHtml(f.fhirId || f.id)}</span>
            </div>
          </div>
          <div class="fac-meta-right">
            ${isActive ? '<span class="fac-badge fac-badge-active">✓ Active</span>' : '<span class="fac-badge">Select</span>'}
          </div>
        </button>
      `;
    })
    .join('');

  container.querySelectorAll('.facility-card-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.facilityId;
      const targetFac = facilities.find((x) => String(x.fhirId || x.id) === String(targetId));
      if (targetFac) {
        setActiveFacility(targetFac);
      }
    });
  });
}

async function openFacilitySwitcherModal() {
  const modal = $('#facilitySwitcherModal');
  if (!modal) return;
  modal.hidden = false;
  const input = $('#facilitySearchInput');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 50);
  }
  const container = $('#facilityPickerList');
  if (container) {
    container.innerHTML = '<p class="placeholder" style="padding: 1rem; text-align: center;">Loading facilities…</p>';
  }
  const facilities = await loadAllFacilitiesForSwitcher();
  renderFacilityPickerList(facilities, '');

  if (input) {
    input.oninput = (e) => {
      renderFacilityPickerList(facilities, e.target.value);
    };
  }
}

function closeFacilitySwitcherModal() {
  const modal = $('#facilitySwitcherModal');
  if (modal) modal.hidden = true;
}

function formatPractitionerDisplayName(p) {
  if (!p) return '';
  return [p.prefix, p.givenName, p.familyName].filter(Boolean).join(' ').trim();
}

function parsePractitionerFullName(raw) {
  const parts = String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) {
    return { prefix: 'Dr.', givenName: '', familyName: '' };
  }
  let prefix = '';
  if (/^dr\.?$/i.test(parts[0])) {
    prefix = 'Dr.';
    parts.shift();
  } else if (/^prof\.?$/i.test(parts[0])) {
    prefix = 'Prof.';
    parts.shift();
  }
  if (!parts.length) {
    return { prefix: prefix || 'Dr.', givenName: '', familyName: '' };
  }
  if (parts.length === 1) {
    return { prefix: prefix || 'Dr.', givenName: parts[0], familyName: parts[0] };
  }
  const familyName = parts.pop();
  const givenName = parts.join(' ');
  return { prefix: prefix || 'Dr.', givenName, familyName };
}

function buildPractitionerPayloadFromForm(form) {
  syncRoleSpecialtyHidden(form);
  const entries = Object.fromEntries(new FormData(form).entries());
  if (form.fullName) {
    const parsed = parsePractitionerFullName(entries.fullName);
    entries.prefix = parsed.prefix;
    entries.givenName = parsed.givenName;
    entries.familyName = parsed.familyName;
    delete entries.fullName;
  }
  delete entries.editId;
  delete entries.editFhirId;
  delete entries.roleSpecialty;
  return entries;
}

function closePractitionerQuickModal() {
  const modal = $('#practitionerQuickModal');
  if (modal) modal.hidden = true;
}

function closePractitionerRoleQuickModal() {
  const modal = $('#practitionerRoleQuickModal');
  if (modal) modal.hidden = true;
}

function resetPractitionerQuickForm() {
  const form = $('#practitionerQuickForm');
  if (!form) return;
  form.reset();
  state.pracFormMode = 'create';
  $('#practitionerQuickEditId').value = '';
  $('#practitionerQuickEditFhirId').value = '';
  if ($('#practitionerQuickEditRoleFhirId')) $('#practitionerQuickEditRoleFhirId').value = '';
  $('#practitionerQuickTitle').textContent = 'Add Practitioner & Role (Bundle)';
  if (form.gender) form.gender.value = 'male';
  const stamp = Date.now().toString().slice(-6);
  if (form.prcId) {
    const team = state.health?.teamPrefix || 'TEAM07';
    form.prcId.value = `${team}-${stamp}`;
  }
  populateFacilityDropdown($('#practitionerQuickOrgSelect'), defaultFacilityFhirId());
  setRoleSpecialtyValue(form, DEFAULT_ROLE_CODE, DEFAULT_ROLE_DISPLAY, DEFAULT_ROLE_SYSTEM);
}

async function populateFacilityDropdown(selectEl, selectedFhirId = '') {
  if (!selectEl) return;
  if (!state.practitionerRoles.lookups.organizations.length) {
    try {
      const res = await fetch('/api/organizations?source=fhir&count=200');
      const data = await res.json();
      state.practitionerRoles.lookups.organizations = data.organizations || [];
    } catch {
      // fallback
    }
  }
  const orgs = state.practitionerRoles.lookups.organizations || [];
  const options = ['<option value="">-- Select Facility / Organization --</option>'];
  orgs.forEach((o) => {
    const fId = o.fhirId || o.id;
    const isSel = String(fId) === String(selectedFhirId) ? 'selected' : '';
    options.push(
      `<option value="${escapeHtml(fId)}" ${isSel}>${escapeHtml(o.name || fId)} (${escapeHtml(o.nhfrCode || o.localCode || fId)})</option>`
    );
  });
  selectEl.innerHTML = options.join('');
}

function fillPractitionerQuickForm(p) {
  const form = $('#practitionerQuickForm');
  if (!form) return;
  if (form.fullName) {
    form.fullName.value = formatPractitionerDisplayName(p) || '';
  }
  if (form.gender) form.gender.value = p.gender || 'male';
  if (form.prcId) form.prcId.value = p.prcId && p.prcId !== '-' ? p.prcId : '';
  if (form.phone) form.phone.value = p.phone || '';
  $('#practitionerQuickEditId').value = p.id || '';
  $('#practitionerQuickEditFhirId').value = p.fhirId || '';
  if ($('#practitionerQuickEditRoleFhirId')) {
    $('#practitionerQuickEditRoleFhirId').value = p.roleFhirId || '';
  }
  $('#practitionerQuickTitle').textContent = 'Edit Practitioner & Role';
  populateFacilityDropdown(
    $('#practitionerQuickOrgSelect'),
    p.organizationFhirId || defaultFacilityFhirId()
  );
  setRoleSpecialtyValue(
    form,
    p.roleCode || DEFAULT_ROLE_CODE,
    p.roleDisplay || DEFAULT_ROLE_DISPLAY,
    p.roleSystem || DEFAULT_ROLE_SYSTEM
  );
}

function openPractitionerQuickModal(mode = 'create', practitioner = null) {
  if (mode === 'create') {
    resetPractitionerQuickForm();
  } else if (practitioner) {
    fillPractitionerQuickForm(practitioner);
  }
  const modal = $('#practitionerQuickModal');
  if (modal) modal.hidden = false;
}

function syncRoleQuickActiveHidden() {
  const toggle = $('#roleQuickActiveToggle');
  const hidden = $('#roleQuickActiveValue');
  if (toggle && hidden) hidden.value = toggle.checked ? 'true' : 'false';
}

const DEFAULT_ROLE_CODE = '158965000';
const DEFAULT_ROLE_DISPLAY = 'Doctor';
const DEFAULT_ROLE_SYSTEM = 'http://snomed.info/sct';

function syncRoleSpecialtyHidden(form) {
  if (!form) return;
  const specialty = form.roleSpecialty?.value || '';
  const [code, ...displayParts] = specialty.includes('|')
    ? specialty.split('|')
    : [specialty];
  const display = displayParts.join('|');
  const match = (state.practitionerRoles.lookups.roleCodes || []).find(
    (r) => String(r.code) === String(code)
  );
  if (form.roleCode) {
    form.roleCode.value = code || DEFAULT_ROLE_CODE;
  }
  if (form.roleDisplay) {
    form.roleDisplay.value = display || match?.display || code || DEFAULT_ROLE_DISPLAY;
  }
  if (form.roleSystem) {
    form.roleSystem.value = match?.system || form.roleSystem.value || DEFAULT_ROLE_SYSTEM;
  }
}

function setRoleSpecialtyValue(form, roleCode, roleDisplay, roleSystem) {
  if (!form?.roleSpecialty) return;
  const select = form.roleSpecialty;
  const code = roleCode || DEFAULT_ROLE_CODE;
  const display = roleDisplay || DEFAULT_ROLE_DISPLAY;
  const system = roleSystem || DEFAULT_ROLE_SYSTEM;
  const exact = `${code}|${display}`;

  destroyRoleSpecialtySelect(select);
  select.innerHTML = '<option value=""></option>';
  const opt = document.createElement('option');
  opt.value = exact;
  opt.textContent = display;
  opt.dataset.system = system;
  opt.selected = true;
  select.appendChild(opt);
  select.value = exact;

  if (form.roleCode) form.roleCode.value = code;
  if (form.roleDisplay) form.roleDisplay.value = display;
  if (form.roleSystem) form.roleSystem.value = system;

  const cached = state.practitionerRoles.lookups.roleCodes || [];
  if (!cached.some((r) => String(r.code) === String(code))) {
    state.practitionerRoles.lookups.roleCodes = [
      ...cached,
      { code, display, system, id: exact, text: display },
    ];
  }

  initRoleSpecialtySelect(select, { force: true });
  syncRoleSpecialtyHidden(form);
}

function syncRoleQuickHiddenFields() {
  const form = $('#practitionerRoleQuickForm');
  if (!form) return;
  syncRoleQuickActiveHidden();
  syncRoleSpecialtyHidden(form);
  const pracId = form.practitionerFhirId?.value || '';
  const prac = (state.practitionerRoles.lookups.practitioners || []).find(
    (p) => String(p.fhirId) === String(pracId)
  );
  if ($('#practitionerRoleQuickPrcId')) {
    $('#practitionerRoleQuickPrcId').value =
      prac?.prcId && prac.prcId !== '-' ? prac.prcId : '';
  }
  if ($('#practitionerRoleQuickPractitionerName')) {
    $('#practitionerRoleQuickPractitionerName').value = formatPractitionerDisplayName(prac);
  }
  const orgId = form.organizationFhirId?.value || '';
  const org = (state.practitionerRoles.lookups.organizations || []).find(
    (o) => String(o.fhirId) === String(orgId)
  );
  if ($('#practitionerRoleQuickOrganizationName')) {
    $('#practitionerRoleQuickOrganizationName').value = org?.name || '';
  }
}

function resetPractitionerRoleQuickForm() {
  const form = $('#practitionerRoleQuickForm');
  if (!form) return;
  form.reset();
  state.roleFormMode = 'create';
  $('#practitionerRoleQuickEditId').value = '';
  $('#practitionerRoleQuickEditFhirId').value = '';
  $('#practitionerRoleQuickTitle').textContent = 'Add Practitioner Role Assignment';
  const toggle = $('#roleQuickActiveToggle');
  if (toggle) toggle.checked = true;
  setRoleSpecialtyValue(form, DEFAULT_ROLE_CODE, DEFAULT_ROLE_DISPLAY, DEFAULT_ROLE_SYSTEM);
  syncRoleQuickActiveHidden();
  preparePractitionerRoleFormLookups({
    preferredOrganization: defaultFacilityFhirId(),
  });
}

function fillPractitionerRoleQuickForm(role) {
  const form = $('#practitionerRoleQuickForm');
  if (!form) return;
  $('#practitionerRoleQuickEditId').value = role.id || '';
  $('#practitionerRoleQuickEditFhirId').value = role.fhirId || '';
  $('#practitionerRoleQuickTitle').textContent = 'Edit Practitioner Role Assignment';
  const toggle = $('#roleQuickActiveToggle');
  if (toggle) toggle.checked = role.active !== false;
  syncRoleQuickActiveHidden();
  setRoleSpecialtyValue(form, role.roleCode, role.roleDisplay, role.roleSystem);
  preparePractitionerRoleFormLookups({
    preferredPractitioner: role.practitionerFhirId || '',
    preferredOrganization: role.organizationFhirId || defaultFacilityFhirId(),
    preferredRoleCode: role.roleCode || '',
    preferredRoleDisplay: role.roleDisplay || '',
    preferredRoleSystem: role.roleSystem || '',
  }).then(() => {
    if (form.practitionerFhirId && role.practitionerFhirId) {
      form.practitionerFhirId.value = role.practitionerFhirId;
      syncSearchableSelect(form.practitionerFhirId);
    }
    if (form.organizationFhirId && role.organizationFhirId) {
      form.organizationFhirId.value = role.organizationFhirId;
      syncSearchableSelect(form.organizationFhirId);
    }
    syncRoleQuickHiddenFields();
  });
}

function openPractitionerRoleQuickModal(mode = 'create') {
  if (mode === 'create') resetPractitionerRoleQuickForm();
  const modal = $('#practitionerRoleQuickModal');
  if (modal) modal.hidden = false;
}

function applyHealthData(data) {
  if (!data) return;
  state.health = data;

  const dbOk = data.localDb?.status === 'connected';
  const fhirOk = data.fhir?.status === 'connected';

  if ($('#fhirStatus')) $('#fhirStatus').textContent = fhirOk ? 'Connected' : 'Disconnected';
  if ($('#dbStatusCard')) $('#dbStatusCard').textContent = dbOk ? 'Connected' : 'Disconnected';
  if ($('#fhirStatusCard')) $('#fhirStatusCard').textContent = fhirOk ? 'Connected' : 'Disconnected';
  syncDot($('#fhirDot'), data.fhir?.status);
  syncDot($('#dbDotCard'), data.localDb?.status);
  syncDot($('#fhirDotCard'), data.fhir?.status);
  if ($('#lastChecked') && data.checkedAt) {
    $('#lastChecked').textContent = new Date(data.checkedAt).toLocaleString();
  }

  syncActiveFacilityUi();

  if (state.inbox.receivingOrgFhirId == null) {
    // Default to all facilities so the first Incoming load is not empty.
    state.inbox.receivingOrgFhirId = '';
  }
}

function applyDashboardData(data) {
  if (!data) return;
  state.dashboard = data;

  const counts = data.counts || {};
  const referrals = data.referrals || {};
  const sentTotal =
    Number(referrals.accepted || 0) +
    Number(referrals.pending || 0) +
    Number(referrals.rejected || 0);

  const setText = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };

  setText('#countPatients', counts.patients ?? 0);
  setText('#countSynced', data.sync?.synced ?? 0);
  setText('#countPendingSync', counts.pendingSync ?? ((data.sync?.pending || 0) + (data.sync?.failed || 0)));
  setText('#countOrganizations', counts.organizations ?? 0);
  setText('#countInbox', referrals.pending ?? referrals.received ?? 0);
  setText('#countSent', sentTotal);
  setText('#metricPending', data.sync?.pending ?? 0);
  setText('#metricFailed', data.sync?.failed ?? 0);
  setText('#metricSynced', data.sync?.synced ?? 0);
  setText('#refReceived', referrals.received ?? 0);
  setText('#refAccepted', referrals.accepted ?? 0);
  setText('#refPending', referrals.pending ?? 0);
  setText('#refRejected', referrals.rejected ?? 0);
  setInboxBadgeCount(referrals.pending || referrals.received || 0);

  const body = $('#activityBody');
  if (!body) return;
  if (!data.activity?.length) {
    body.innerHTML = `<p class="placeholder">No activity yet - register a patient to begin</p>`;
  } else {
    body.innerHTML = data.activity
      .map((a) => {
        const details = a.details && a.details !== '-' ? escapeHtml(a.details) : '';
        return `<article class="activity-item" role="listitem">
          <div class="activity-item-top">
            <div class="activity-item-meta">
              <time datetime="${escapeHtml(a.time || '')}">${formatTime(a.time)}</time>
              <span class="activity-type">${escapeHtml(a.type || '-')}</span>
            </div>
            ${statusTag(a.syncStatus)}
          </div>
          <p class="activity-name">${escapeHtml(a.name || '-')}</p>
          <p class="activity-action">${escapeHtml(a.action || '-')}</p>
          ${details ? `<p class="activity-details">${details}</p>` : ''}
        </article>`;
      })
      .join('');
  }
}

function currentViewId() {
  const active = document.querySelector('.view.active');
  return active?.id?.replace(/^view-/, '') || '';
}

function initRealtime() {
  if (typeof io !== 'function') {
    setLiveStatus('err', 'Unavailable');
    return;
  }

  const isServerlessHost =
    window.location.hostname.includes('netlify.app') ||
    window.location.hostname.includes('.app');

  if (isServerlessHost) {
    setLiveStatus('connected', 'Live (FHIR CDR)');
    return;
  }

  const socket = io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    timeout: 5000,
  });

  state.socket = socket;
  setLiveStatus('checking', 'Connecting...');

  socket.on('connect', () => {
    setLiveStatus('connected', 'Connected');
  });

  socket.on('disconnect', () => {
    setLiveStatus('err', 'Disconnected');
  });

  socket.on('connect_error', () => {
    setLiveStatus('err', 'Offline');
  });

  socket.on('realtimeConnected', () => {
    setLiveStatus('connected', 'Connected');
  });

  socket.on('dashboardUpdated', (data) => {
    applyDashboardData(data);
    const view = currentViewId();
    if (view === 'sync') renderSyncMonitor();
  });

  socket.on('healthUpdated', (data) => {
    applyHealthData(data);
  });

  socket.on('entityChanged', ({ entity, action, record }) => {
    const view = currentViewId();
    if (entity === 'patient' && view === 'patients') {
      handlePatientRealtime({ action, record });
    }
    if (entity === 'organization' && view === 'organizations') {
      state.organizations.page = 1;
      loadOrganizations({ source: 'fhir' });
    }
    if (entity === 'practitioner' && view === 'practitioners') {
      state.practitioners.page = 1;
      loadPractitioners({ source: 'fhir' });
    }
    if (entity === 'practitioner-role' && view === 'practitioner-roles') {
      state.practitionerRoles.page = 1;
      loadPractitionerRoles({ source: 'fhir' });
    }
    if (entity === 'referral' && (view === 'sent' || view === 'new-referral' || view === 'inbox')) {
      if (view === 'sent') loadSentReferrals();
      if (view === 'inbox') loadInboxReferrals({ quiet: true, page: state.inbox.page });
      if (view === 'new-referral') prepareReferralForm({ quiet: true });
    }
    if (entity === 'sync' && view === 'sync') renderSyncMonitor();
  });

  socket.on('syncCompleted', (result) => {
    const view = currentViewId();
    if (view === 'sync') renderSyncMonitor();
    if (view === 'patients') {
      state.patients.page = 1;
      schedulePatientsReload({ silent: true, delay: 400 });
    }
    if (result?.message) {
      showToast(result.message, 'ok', { title: 'Sync update' });
    }
  });
}

function isFhirChecking() {
  if (state.health?.fhir?.status === 'connected') return false;
  const label = ($('#fhirStatus')?.textContent || '').trim().toLowerCase();
  if (label.includes('checking')) return true;
  if (!state.health) return true;
  return false;
}

function inboxLoadingMessage() {
  return 'Loading incoming referrals from FHIR...';
}

async function loadHealth() {
  const alreadyConnected = state.health?.fhir?.status === 'connected';
  if (!alreadyConnected) {
    if ($('#fhirStatus')) $('#fhirStatus').textContent = 'Checking...';
    syncDot($('#fhirDot'), 'checking');
    if ($('#fhirStatusCard')) $('#fhirStatusCard').textContent = 'Checking...';
    syncDot($('#fhirDotCard'), 'checking');
  }

  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    applyHealthData(data);
  } catch (err) {
    if ($('#fhirStatus')) $('#fhirStatus').textContent = 'Disconnected';
    syncDot($('#fhirDot'), 'err');
    if ($('#dbStatusCard')) $('#dbStatusCard').textContent = 'Disconnected';
    if ($('#fhirStatusCard')) $('#fhirStatusCard').textContent = 'Disconnected';
    syncDot($('#dbDotCard'), 'err');
    syncDot($('#fhirDotCard'), 'err');
  }
}

function statusTag(status) {
  const s = (status || '').toLowerCase();
  if (s === 'synced' || s === 'accepted' || s === 'completed') {
    return `<span class="tag"><span class="dot ok"></span>${escapeHtml(status)}</span>`;
  }
  if (s === 'pending' || s === 'requested' || s === 'in-progress' || s === 'received' || s === 'on-hold') {
    return `<span class="tag"><span class="dot warn"></span>${escapeHtml(status)}</span>`;
  }
  if (s === 'failed' || s === 'rejected' || s === 'cancelled') {
    return `<span class="tag"><span class="dot err"></span>${escapeHtml(status)}</span>`;
  }
  return `<span class="tag"><span class="dot"></span>${escapeHtml(status || '-')}</span>`;
}

function formatTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function loadDashboard() {
  await loadHealth();
  try {
    const res = await fetch('/api/dashboard');
    if (!res.ok) throw new Error((await res.json()).error || 'Dashboard failed');
    applyDashboardData(await res.json());
  } catch (err) {
    const body = $('#activityBody');
    if (body) {
      body.innerHTML = `<p class="placeholder">${escapeHtml(err.message)}</p>`;
    }
  }
}

function closeAllActionMenus() {
  document.querySelectorAll('.action-menu.open').forEach((menu) => {
    menu.classList.remove('open');
    const toggle = menu.querySelector('.action-menu-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    const panel = menu.querySelector('.action-menu-panel');
    if (panel) {
      panel.hidden = true;
      panel.style.top = '';
      panel.style.right = '';
      panel.style.bottom = '';
      panel.style.left = '';
    }
  });
}

function positionActionMenu(menu) {
  const toggle = menu.querySelector('.action-menu-toggle');
  const panel = menu.querySelector('.action-menu-panel');
  if (!toggle || !panel) return;

  panel.hidden = false;
  const rect = toggle.getBoundingClientRect();
  const panelWidth = Math.max(panel.offsetWidth || 160, 160);
  const spaceBelow = window.innerHeight - rect.bottom;
  const openUp = spaceBelow < 180 && rect.top > spaceBelow;

  panel.style.left = 'auto';
  panel.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  if (openUp) {
    panel.style.top = 'auto';
    panel.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 4)}px`;
  } else {
    panel.style.bottom = 'auto';
    panel.style.top = `${rect.bottom + 4}px`;
  }

  const maxLeft = window.innerWidth - panelWidth - 8;
  const desiredLeft = rect.right - panelWidth;
  if (desiredLeft < 8) {
    panel.style.right = 'auto';
    panel.style.left = `${Math.min(maxLeft, 8)}px`;
  }
}

function actionMenu(itemsHtml) {
  const items = String(itemsHtml || '').trim();
  if (!items) return '';
  return `<div class="action-menu">
    <button
      type="button"
      class="action-menu-toggle"
      aria-haspopup="menu"
      aria-expanded="false"
      aria-label="Open actions"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="5" r="1.8"/>
        <circle cx="12" cy="12" r="1.8"/>
        <circle cx="12" cy="19" r="1.8"/>
      </svg>
    </button>
    <div class="action-menu-panel" role="menu" hidden>
      ${items}
    </div>
  </div>`;
}

function actionMenuItem(label, attrs = '', { danger = false } = {}) {
  const cls = danger ? 'action-menu-item danger' : 'action-menu-item';
  return `<button type="button" class="${cls}" role="menuitem" ${attrs}>${escapeHtml(
    label
  )}</button>`;
}

function patientActionButtons(p) {
  const idAttr = p.id ? `data-id="${p.id}"` : '';
  const fhirAttr = p.fhirId ? `data-fhir-id="${escapeHtml(p.fhirId)}"` : '';
  const items = [
    actionMenuItem('View', `data-action="view" data-entity="patient" ${idAttr} ${fhirAttr}`),
    actionMenuItem('Edit', `data-action="edit" data-entity="patient" ${idAttr} ${fhirAttr}`),
    p.id && p.syncStatus !== 'synced'
      ? actionMenuItem('Retry', `data-resync="${p.id}"`)
      : '',
    p.id || p.fhirId
      ? actionMenuItem(
          'Delete',
          `data-action="delete" data-entity="patient" ${idAttr} ${fhirAttr}`,
          { danger: true }
        )
      : '',
  ]
    .filter(Boolean)
    .join('');
  return actionMenu(items);
}

function organizationActionButtons(o) {
  const idAttr = o.id ? `data-id="${o.id}"` : '';
  const fhirAttr = o.fhirId ? `data-fhir-id="${escapeHtml(o.fhirId)}"` : '';
  const items = [
    actionMenuItem('View', `data-action="view" data-entity="organization" ${idAttr} ${fhirAttr}`),
    actionMenuItem('Edit', `data-action="edit" data-entity="organization" ${idAttr} ${fhirAttr}`),
    o.id && o.syncStatus !== 'synced'
      ? actionMenuItem('Retry', `data-resync-org="${o.id}"`)
      : '',
    o.id || o.fhirId
      ? actionMenuItem(
          'Delete',
          `data-action="delete" data-entity="organization" ${idAttr} ${fhirAttr}`,
          { danger: true }
        )
      : '',
  ]
    .filter(Boolean)
    .join('');
  return actionMenu(items);
}

function practitionerActionButtons(p) {
  const idAttr = p.id ? `data-id="${p.id}"` : '';
  const fhirAttr = p.fhirId ? `data-fhir-id="${escapeHtml(p.fhirId)}"` : '';
  const items = [
    actionMenuItem('View', `data-action="view" data-entity="practitioner" ${idAttr} ${fhirAttr}`),
    actionMenuItem('Edit', `data-action="edit" data-entity="practitioner" ${idAttr} ${fhirAttr}`),
    p.id && p.syncStatus !== 'synced'
      ? actionMenuItem('Retry', `data-resync-prac="${p.id}"`)
      : '',
    p.id || p.fhirId
      ? actionMenuItem(
          'Delete',
          `data-action="delete" data-entity="practitioner" ${idAttr} ${fhirAttr}`,
          { danger: true }
        )
      : '',
  ]
    .filter(Boolean)
    .join('');
  return actionMenu(items);
}

function practitionerRoleActionButtons(r) {
  const idAttr = r.id ? `data-id="${r.id}"` : '';
  const fhirAttr = r.fhirId ? `data-fhir-id="${escapeHtml(r.fhirId)}"` : '';
  const items = [
    actionMenuItem('View', `data-action="view" data-entity="practitioner-role" ${idAttr} ${fhirAttr}`),
    actionMenuItem('Edit', `data-action="edit" data-entity="practitioner-role" ${idAttr} ${fhirAttr}`),
    r.id && r.syncStatus !== 'synced'
      ? actionMenuItem('Retry', `data-resync-role="${r.id}"`)
      : '',
    r.id || r.fhirId
      ? actionMenuItem(
          'Delete',
          `data-action="delete" data-entity="practitioner-role" ${idAttr} ${fhirAttr}`,
          { danger: true }
        )
      : '',
  ]
    .filter(Boolean)
    .join('');
  return actionMenu(items);
}

function updatePager() {
  const { page, totalPages, total, pageSize, q } = state.patients;
  $('#patientsPageLabel').textContent = `Page ${page} of ${totalPages}`;
  $('#patientsPrev').disabled = page <= 1;
  $('#patientsNext').disabled = page >= totalPages;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  $('#patientsMeta').textContent = q
    ? `${from}-${to} of ${total} match${total === 1 ? '' : 'es'}`
    : `${from}-${to} of ${total}`;
}

function patientMatchesSearch(patient, q) {
  if (!q) return true;
  const hay = [
    patient.localCode,
    patient.familyName,
    patient.givenName1,
    patient.givenName2,
    patient.philsysId,
    patient.philhealthId,
    patient.fhirId,
    patient.birthDate,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(String(q).toLowerCase());
}

function patientSortKey(p) {
  const created = Date.parse(p.createdAt || p.updatedAt || p.syncedAt || '') || 0;
  const localId = Number(p.id) || 0;
  const fhirNum = Number(p.fhirId);
  const fhirId = Number.isFinite(fhirNum) ? fhirNum : 0;
  return { created, localId, fhirId };
}

function sortPatientsNewestFirst(patients) {
  return [...patients].sort((a, b) => {
    const ka = patientSortKey(a);
    const kb = patientSortKey(b);
    const recencyGap = kb.created - ka.created;
    // Brand-new local rows may not have a numeric FHIR ID yet; keep them on page 1.
    if (recencyGap !== 0 && (ka.fhirId === 0 || kb.fhirId === 0) && Math.abs(recencyGap) < 5 * 60 * 1000) {
      return recencyGap;
    }
    if (kb.fhirId !== ka.fhirId) return kb.fhirId - ka.fhirId;
    if (recencyGap !== 0) return recencyGap;
    return kb.localId - ka.localId;
  });
}

function samePatient(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && Number(a.id) === Number(b.id)) return true;
  if (a.fhirId && b.fhirId && String(a.fhirId) === String(b.fhirId)) return true;
  if (
    a.localCode &&
    b.localCode &&
    a.localCode !== '-' &&
    String(a.localCode) === String(b.localCode)
  ) {
    return true;
  }
  if (
    a.philsysId &&
    b.philsysId &&
    a.philsysId !== '-' &&
    String(a.philsysId) === String(b.philsysId)
  ) {
    return true;
  }
  return false;
}

function renderPatientsTable() {
  const body = $('#patientsBody');
  const subtitle = $('#patientsSubtitle');
  if (!body) return;

  const allPatients = state.patients.items || [];
  const pageSize = state.patients.pageSize;
  const total = allPatients.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const page = Math.min(Math.max(1, state.patients.page), totalPages);
  const start = (page - 1) * pageSize;
  const patients = allPatients.slice(start, start + pageSize);

  state.patients.page = page;
  state.patients.totalPages = totalPages;
  state.patients.total = total;

  if (subtitle) {
    subtitle.textContent =
      state.patients.source === 'fhir'
        ? state.patients.warning || 'Patients from FHIR server (newest first)'
        : state.patients.warning || 'Local registry with FHIR sync status';
  }

  updatePager();

  if (!patients.length) {
    body.innerHTML = `<tr><td colspan="6" class="placeholder">${
      state.patients.q ? 'No patients match your search' : 'No patients yet'
    }</td></tr>`;
    return;
  }

  body.innerHTML = patients
    .map((p) => {
      const fhirId = p.fhirId || '-';
      const name = `${p.givenName1 || ''} ${p.familyName || ''}`.trim() || '-';
      const philhealthId = p.philhealthId || '-';
      return `<tr>
          <td><span class="cell-truncate" title="${escapeHtml(fhirId)}">${escapeHtml(fhirId)}</span></td>
          <td><span class="cell-ellipsis" title="${escapeHtml(name)}">${escapeHtml(name)}</span></td>
          <td>${escapeHtml(p.philsysId || '-')}</td>
          <td><span class="cell-ellipsis" title="${escapeHtml(philhealthId)}">${escapeHtml(philhealthId)}</span></td>
          <td>${escapeHtml(p.birthDate || '-')}</td>
          <td class="col-actions">${patientActionButtons(p)}</td>
        </tr>`;
    })
    .join('');
}

function applyPatientsData(data) {
  const sorted = sortPatientsNewestFirst(data.patients || []);
  state.patients.items = sorted;
  state.patients.source = data.source || 'local';
  state.patients.warning = data.warning || null;
  mergeRecentPatientsIntoState();
  renderPatientsTable();
}

function rememberRecentPatient(record) {
  if (!record) return;
  const now = Date.now();
  const stamped = {
    ...record,
    createdAt: record.createdAt || new Date(now).toISOString(),
    updatedAt: record.updatedAt || new Date(now).toISOString(),
  };
  const kept = (state.patients.recentCreates || []).filter(
    (x) => x.expiresAt > now && !samePatient(x.record, stamped)
  );
  kept.unshift({ record: stamped, expiresAt: now + 5 * 60_000 });
  state.patients.recentCreates = kept.slice(0, 25);
}

function mergeRecentPatientsIntoState() {
  const now = Date.now();
  const recent = (state.patients.recentCreates || []).filter((x) => x.expiresAt > now);
  state.patients.recentCreates = recent;
  if (!recent.length) return;

  let items = [...(state.patients.items || [])];
  let changed = false;
  for (const { record } of recent) {
    if (state.patients.q && !patientMatchesSearch(record, state.patients.q)) continue;
    const idx = items.findIndex((p) => samePatient(p, record));
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...record, fhirId: record.fhirId || items[idx].fhirId };
    } else {
      items.unshift({
        ...record,
        source: record.fhirId ? 'fhir' : record.source || 'local',
      });
      changed = true;
    }
  }
  if (changed || recent.length) {
    state.patients.items = sortPatientsNewestFirst(items);
  }
}

function upsertPatientRealtime(record, action) {
  if (!record) return false;
  const q = state.patients.q;
  let items = [...(state.patients.items || [])];
  const idx = items.findIndex((p) => samePatient(p, record));

  if (action === 'created') {
    if (q && !patientMatchesSearch(record, q)) return false;
    if (idx >= 0) items.splice(idx, 1);
    items.unshift({
      ...record,
      source: record.fhirId ? 'fhir' : record.source || 'local',
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || new Date().toISOString(),
    });
    state.patients.page = 1;
  } else {
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...record };
    } else if (!q || patientMatchesSearch(record, q)) {
      items.unshift(record);
      state.patients.page = 1;
    } else {
      return false;
    }
  }

  state.patients.items = sortPatientsNewestFirst(items);
  if (state.patients.source !== 'fhir') state.patients.source = 'fhir';
  renderPatientsTable();
  return true;
}

let patientsReloadTimer = null;
function schedulePatientsReload({ silent = true, delay = 350 } = {}) {
  clearTimeout(patientsReloadTimer);
  patientsReloadTimer = setTimeout(() => {
    loadPatients({ silent });
  }, delay);
}

function handlePatientRealtime({ action, record } = {}) {
  const isCreate = action === 'created';
  if (isCreate) state.patients.page = 1;

  // Show the new/updated row immediately, then refresh from FHIR for the full set.
  if (record && (action === 'created' || action === 'updated')) {
    upsertPatientRealtime(record, action);
  }

  schedulePatientsReload({ silent: true, delay: isCreate ? 600 : 350 });
}

let patientsLoadSeq = 0;
async function loadPatients({ silent = false } = {}) {
  const body = $('#patientsBody');
  const subtitle = $('#patientsSubtitle');
  if (!silent) {
    body.innerHTML = `<tr><td colspan="6" class="placeholder">Loading patients from FHIR...</td></tr>`;
  }

  const seq = ++patientsLoadSeq;
  const params = new URLSearchParams();
  params.set('source', 'fhir');
  params.set('count', '200');
  if (state.patients.q) params.set('q', state.patients.q);

  try {
    const res = await fetch(`/api/patients?${params}`);
    const data = await res.json();
    if (seq !== patientsLoadSeq) return;
    if (!res.ok) throw new Error(data.error || 'Failed to load patients');
    applyPatientsData(data);
  } catch (err) {
    if (seq !== patientsLoadSeq) return;
    if (!silent || !(state.patients.items || []).length) {
      body.innerHTML = `<tr><td colspan="6" class="placeholder">${escapeHtml(err.message)}</td></tr>`;
      $('#patientsMeta').textContent = '-';
    }
    if (subtitle && !silent) {
      subtitle.textContent = 'Could not load patients';
    }
    showToast(err.message, 'err', { title: 'Patients' });
  }
}

function updateOrgPager() {
  const { page, totalPages, total, pageSize, q } = state.organizations;
  const label = $('#organizationsPageLabel');
  const prev = $('#organizationsPrev');
  const next = $('#organizationsNext');
  const meta = $('#organizationsMeta');
  if (label) label.textContent = `Page ${page} of ${totalPages}`;
  if (prev) prev.disabled = page <= 1;
  if (next) next.disabled = page >= totalPages;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  if (meta) {
    meta.textContent = q
      ? `${from}-${to} of ${total} match${total === 1 ? '' : 'es'}`
      : `${from}-${to} of ${total}`;
  }
}

function updatePracPager() {
  const { page, totalPages, total, pageSize, q } = state.practitioners;
  const label = $('#practitionersPageLabel');
  const prev = $('#practitionersPrev');
  const next = $('#practitionersNext');
  const meta = $('#practitionersMeta');
  if (label) label.textContent = `Page ${page} of ${totalPages}`;
  if (prev) prev.disabled = page <= 1;
  if (next) next.disabled = page >= totalPages;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  if (meta) {
    meta.textContent = q
      ? `${from}-${to} of ${total} match${total === 1 ? '' : 'es'}`
      : `${from}-${to} of ${total}`;
  }
}

function updateRolePager() {
  const { page, totalPages, total, pageSize, q } = state.practitionerRoles;
  const label = $('#practitionerRolesPageLabel');
  const prev = $('#practitionerRolesPrev');
  const next = $('#practitionerRolesNext');
  const meta = $('#practitionerRolesMeta');
  if (label) label.textContent = `Page ${page} of ${totalPages}`;
  if (prev) prev.disabled = page <= 1;
  if (next) next.disabled = page >= totalPages;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  if (meta) {
    meta.textContent = q
      ? `${from}-${to} of ${total} match${total === 1 ? '' : 'es'}`
      : `${from}-${to} of ${total}`;
  }
}

function sortOrganizationsNewestFirst(organizations) {
  return [...organizations].sort((a, b) => {
    const fhirB = Number(b.fhirId);
    const fhirA = Number(a.fhirId);
    const fb = Number.isFinite(fhirB) ? fhirB : -1;
    const fa = Number.isFinite(fhirA) ? fhirA : -1;
    if (fb !== fa) return fb - fa;
    const tb = Math.max(
      Date.parse(b.updatedAt || '') || 0,
      Date.parse(b.createdAt || '') || 0,
      Date.parse(b.syncedAt || '') || 0
    );
    const ta = Math.max(
      Date.parse(a.updatedAt || '') || 0,
      Date.parse(a.createdAt || '') || 0,
      Date.parse(a.syncedAt || '') || 0
    );
    if (tb !== ta) return tb - ta;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}

async function loadOrganizations({ source = 'fhir', q } = {}) {
  const body = $('#organizationsBody');
  const subtitle = $('#organizationsSubtitle');
  if (!body) return;

  body.innerHTML = `<tr><td colspan="6" class="placeholder">Loading organizations from FHIR...</td></tr>`;

  const params = new URLSearchParams();
  params.set('source', source || 'fhir');
  params.set('count', '200');
  const query = q !== undefined ? q : ($('#orgSearch')?.value || '').trim();
  state.organizations.q = query;
  if (query) params.set('q', query);

  try {
    const res = await fetch(`/api/organizations?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to load organizations');

    const allOrganizations = sortOrganizationsNewestFirst(data.organizations || []);
    state.organizations.items = allOrganizations;
    const pageSize = state.organizations.pageSize;
    const total = allOrganizations.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const page = Math.min(Math.max(1, state.organizations.page), totalPages);
    const start = (page - 1) * pageSize;
    const organizations = allOrganizations.slice(start, start + pageSize);

    state.organizations.page = page;
    state.organizations.totalPages = totalPages;
    state.organizations.total = total;
    state.organizations.source = data.source || 'fhir';

    if (subtitle) {
      subtitle.textContent =
        data.source === 'fhir'
          ? data.warning || 'Organizations from FHIR server (newest first)'
          : data.warning || 'Local facility registry with FHIR sync status';
    }

    updateOrgPager();

    if (!organizations.length) {
      body.innerHTML = `<tr><td colspan="6" class="placeholder">${
        query ? 'No organizations match your search' : 'No organizations found'
      }</td></tr>`;
      return true;
    }

    body.innerHTML = organizations
      .map((o) => {
        const fhirId = o.fhirId || '-';
        const name = o.name || '-';
        return `<tr>
          <td><span class="cell-truncate" title="${escapeHtml(fhirId)}">${escapeHtml(fhirId)}</span></td>
          <td><span class="cell-ellipsis" title="${escapeHtml(name)}">${escapeHtml(name)}</span></td>
          <td>${escapeHtml(o.nhfrCode || '-')}</td>
          <td>${escapeHtml(o.hcpnCode || '-')}</td>
          <td>${escapeHtml(o.phone || '-')}</td>
          <td>${organizationActionButtons(o)}</td>
        </tr>`;
      })
      .join('');
    return true;
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="placeholder">${escapeHtml(err.message)}</td></tr>`;
    const meta = $('#organizationsMeta');
    if (meta) meta.textContent = '-';
    showToast(err.message, 'err', { title: 'Organizations' });
    return false;
  }
}

async function loadPractitioners({ source = 'fhir', q, silent = false } = {}) {
  const body = $('#practitionersBody');
  const subtitle = $('#practitionersSubtitle');
  if (!body) return;

  if (!silent) {
    body.innerHTML = `<tr><td colspan="6" class="placeholder">Loading practitioners from FHIR...</td></tr>`;
  }

  const params = new URLSearchParams();
  params.set('source', source || 'fhir');
  params.set('count', '200');
  const query = q !== undefined ? q : ($('#pracSearch')?.value || '').trim();
  state.practitioners.q = query;
  if (query) params.set('q', query);

  try {
    const res = await fetch(`/api/practitioners?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to load practitioners');

    applyPractitionersData(data);
    return true;
  } catch (err) {
    if (!silent || !(state.practitioners.items || []).length) {
      body.innerHTML = `<tr><td colspan="6" class="placeholder">${escapeHtml(err.message)}</td></tr>`;
      const meta = $('#practitionersMeta');
      if (meta) meta.textContent = '-';
    }
    if (subtitle && !silent) {
      subtitle.textContent = 'Could not load practitioners';
    }
    showToast(err.message, 'err', { title: 'Practitioners' });
    return false;
  }
}

function sortPractitionersNewestFirst(practitioners) {
  return [...practitioners].sort((a, b) => {
    const fhirB = Number(b.fhirId);
    const fhirA = Number(a.fhirId);
    const fb = Number.isFinite(fhirB) ? fhirB : -1;
    const fa = Number.isFinite(fhirA) ? fhirA : -1;
    if (fb !== fa) return fb - fa;
    const tb = Math.max(
      Date.parse(b.updatedAt || '') || 0,
      Date.parse(b.createdAt || '') || 0,
      Date.parse(b.syncedAt || '') || 0
    );
    const ta = Math.max(
      Date.parse(a.updatedAt || '') || 0,
      Date.parse(a.createdAt || '') || 0,
      Date.parse(a.syncedAt || '') || 0
    );
    if (tb !== ta) return tb - ta;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}

function samePractitioner(a, b) {
  if (!a || !b) return false;
  if (a.fhirId && b.fhirId && String(a.fhirId) === String(b.fhirId)) return true;
  if (a.id != null && b.id != null && Number(a.id) === Number(b.id)) return true;
  if (a.prcId && b.prcId && String(a.prcId) === String(b.prcId)) return true;
  return false;
}

function practitionerMatchesSearch(record, q) {
  if (!q) return true;
  const hay = [
    record.localCode,
    record.familyName,
    record.givenName,
    record.prcId,
    record.fhirId,
    record.roleDisplay,
    record.roleCode,
    record.phone,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(String(q).toLowerCase());
}

function rememberRecentPractitioner(record) {
  if (!record) return;
  const now = Date.now();
  const stamped = {
    ...record,
    createdAt: record.createdAt || new Date(now).toISOString(),
    updatedAt: record.updatedAt || new Date(now).toISOString(),
  };
  const kept = (state.practitioners.recentCreates || []).filter(
    (x) => x.expiresAt > now && !samePractitioner(x.record, stamped)
  );
  kept.unshift({ record: stamped, expiresAt: now + 90_000 });
  state.practitioners.recentCreates = kept.slice(0, 25);
}

function mergeRecentPractitionersIntoState() {
  const now = Date.now();
  const recent = (state.practitioners.recentCreates || []).filter((x) => x.expiresAt > now);
  state.practitioners.recentCreates = recent;
  if (!recent.length) return;

  let items = [...(state.practitioners.items || [])];
  for (const { record } of recent) {
    if (state.practitioners.q && !practitionerMatchesSearch(record, state.practitioners.q)) continue;
    const idx = items.findIndex((p) => samePractitioner(p, record));
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...record, fhirId: record.fhirId || items[idx].fhirId };
    } else {
      items.unshift({
        ...record,
        source: record.fhirId ? 'fhir' : record.source || 'local',
      });
    }
  }
  state.practitioners.items = sortPractitionersNewestFirst(items);
}

function upsertPractitionerRealtime(record, action = 'created') {
  if (!record) return false;
  const q = state.practitioners.q;
  let items = [...(state.practitioners.items || [])];
  const idx = items.findIndex((p) => samePractitioner(p, record));

  if (action === 'created') {
    if (q && !practitionerMatchesSearch(record, q)) return false;
    if (idx >= 0) items.splice(idx, 1);
    items.unshift({
      ...record,
      source: record.fhirId ? 'fhir' : record.source || 'local',
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || new Date().toISOString(),
    });
    state.practitioners.page = 1;
  } else if (idx >= 0) {
    items[idx] = { ...items[idx], ...record };
  } else if (!q || practitionerMatchesSearch(record, q)) {
    items.unshift(record);
    state.practitioners.page = 1;
  } else {
    return false;
  }

  state.practitioners.items = sortPractitionersNewestFirst(items);
  renderPractitionersTable();
  return true;
}

let practitionersReloadTimer = null;
function schedulePractitionersReload({ silent = true, delay = 350 } = {}) {
  clearTimeout(practitionersReloadTimer);
  practitionersReloadTimer = setTimeout(() => {
    loadPractitioners({ source: 'fhir', silent });
  }, delay);
}

function deduplicatePractitionersList(practitioners) {
  if (!Array.isArray(practitioners) || !practitioners.length) return [];
  const groups = new Map();
  for (const p of practitioners) {
    let key = null;
    if (p.prcId && p.prcId !== '-' && p.prcId.trim()) {
      key = `prc:${p.prcId.trim().toLowerCase()}`;
    } else if (p.localCode && p.localCode !== '-' && p.localCode.trim()) {
      key = `local:${p.localCode.trim().toLowerCase()}`;
    } else {
      const name = `${p.givenName || ''} ${p.familyName || ''}`.trim().toLowerCase();
      if (name) {
        key = `name:${name}`;
      } else if (p.fhirId) {
        key = `fhir:${p.fhirId}`;
      } else if (p.id) {
        key = `id:${p.id}`;
      }
    }
    if (!key) key = `anon:${Math.random()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const results = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      results.push(list[0]);
      continue;
    }
    const golden = list.find((p) => p.isGolden);
    if (golden) {
      results.push(golden);
      continue;
    }
    const nonSource = list.filter((p) => !p.isMdmSource);
    const pool = nonSource.length ? nonSource : list;
    pool.sort((a, b) => {
      const tb = Date.parse(b.updatedAt || b.createdAt || b.syncedAt || '') || 0;
      const ta = Date.parse(a.updatedAt || a.createdAt || a.syncedAt || '') || 0;
      if (tb !== ta) return tb - ta;
      return (Number(b.fhirId) || 0) - (Number(a.fhirId) || 0);
    });
    results.push(pool[0]);
  }
  return results;
}

function deduplicatePractitionerRolesList(roles) {
  if (!Array.isArray(roles) || !roles.length) return [];
  const groups = new Map();
  for (const r of roles) {
    let key = null;
    const pracKey =
      (r.practitionerFhirId && `prac:${r.practitionerFhirId}`) ||
      (r.prcId && r.prcId !== '-' && `prc:${r.prcId.trim().toLowerCase()}`) ||
      (r.practitionerName && `name:${r.practitionerName.trim().toLowerCase()}`) ||
      (r.fhirId && `role:${r.fhirId}`) ||
      null;

    const orgKey = r.organizationFhirId || r.organizationName || '';
    const codeKey = r.roleCode || r.roleDisplay || '';

    if (pracKey) {
      key = `${pracKey}|${orgKey}|${codeKey}`;
    } else if (r.fhirId) {
      key = `fhir:${r.fhirId}`;
    } else {
      key = `id:${r.id || Math.random()}`;
    }

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const results = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      results.push(list[0]);
      continue;
    }
    const golden = list.find((r) => r.isGolden);
    if (golden) {
      results.push(golden);
      continue;
    }
    const active = list.filter((r) => r.active !== false);
    const candidateList = active.length ? active : list;
    const nonSource = candidateList.filter((r) => !r.isMdmSource);
    const pool = nonSource.length ? nonSource : candidateList;
    pool.sort((a, b) => {
      const tb = Date.parse(b.updatedAt || b.createdAt || b.syncedAt || '') || 0;
      const ta = Date.parse(a.updatedAt || a.createdAt || a.syncedAt || '') || 0;
      if (tb !== ta) return tb - ta;
      return (Number(b.fhirId) || 0) - (Number(a.fhirId) || 0);
    });
    results.push(pool[0]);
  }
  return results;
}

function applyPractitionersData(data) {
  const deduplicated = deduplicatePractitionersList(data.practitioners || []);
  const sorted = sortPractitionersNewestFirst(deduplicated);
  state.practitioners.items = sorted;
  state.practitioners.source = data.source || 'fhir';
  state.practitioners.warning = data.warning || null;
  mergeRecentPractitionersIntoState();
  renderPractitionersTable();
}

function renderPractitionersTable() {
  const body = $('#practitionersBody');
  const subtitle = $('#practitionersSubtitle');
  if (!body) return;

  const allPractitioners = state.practitioners.items || [];
  const pageSize = state.practitioners.pageSize;
  const total = allPractitioners.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const page = Math.min(Math.max(1, state.practitioners.page), totalPages);
  const start = (page - 1) * pageSize;
  const practitioners = allPractitioners.slice(start, start + pageSize);
  const query = state.practitioners.q;

  state.practitioners.page = page;
  state.practitioners.totalPages = totalPages;
  state.practitioners.total = total;

  if (subtitle) {
    subtitle.textContent =
      state.practitioners.source === 'fhir'
        ? state.practitioners.warning || 'Practitioners from FHIR server (newest first)'
        : state.practitioners.warning || 'Local clinician registry with FHIR sync status';
  }

  updatePracPager();

  if (!practitioners.length) {
    body.innerHTML = `<tr><td colspan="7" class="placeholder">${
      query ? 'No practitioners match your search' : 'No practitioners found'
    }</td></tr>`;
    return;
  }

  body.innerHTML = practitioners
    .map((p) => {
      const fhirId = p.fhirId || '-';
      const name = [p.prefix, p.givenName, p.familyName].filter(Boolean).join(' ') || '-';
      const roleText = p.roleDisplay || p.roleCode || 'Doctor';
      const facilityText = p.organizationName || p.organizationFhirId || '-';
      const isGolden = Boolean(p.isGolden);
      const goldenBadge = isGolden
        ? `<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;font-size:11px;font-weight:600;padding:1px 6px;border-radius:10px;margin-left:5px;" title="MDM Golden Master Record">🌟 Golden</span>`
        : '';
      return `<tr>
          <td><span class="cell-truncate" title="${escapeHtml(fhirId)}">${escapeHtml(fhirId)}</span></td>
          <td>
            <strong class="cell-ellipsis" title="${escapeHtml(name)}">${escapeHtml(name)}</strong>${goldenBadge}
            <small class="muted" style="display:block; font-size:12px;">${escapeHtml(p.gender ? (p.gender[0].toUpperCase() + p.gender.slice(1)) : '')}</small>
          </td>
          <td><span class="code-badge">${escapeHtml(p.prcId || '-')}</span></td>
          <td><span class="badge badge-info" title="${escapeHtml(roleText)}">${escapeHtml(roleText)}</span></td>
          <td><span class="cell-ellipsis" title="${escapeHtml(facilityText)}">${escapeHtml(facilityText)}</span></td>
          <td>${escapeHtml(p.phone || '-')}</td>
          <td>${practitionerActionButtons(p)}</td>
        </tr>`;
    })
    .join('');
}

async function loadPractitionerRoles({ source = 'fhir', q, silent = false } = {}) {
  const body = $('#practitionerRolesBody');
  const subtitle = $('#practitionerRolesSubtitle');
  if (!body) return;

  if (!silent) {
    body.innerHTML = `<tr><td colspan="6" class="placeholder">Loading practitioner roles from FHIR...</td></tr>`;
  }

  const params = new URLSearchParams();
  params.set('source', source || 'fhir');
  params.set('count', '200');
  const query = q !== undefined ? q : ($('#roleSearch')?.value || '').trim();
  state.practitionerRoles.q = query;
  if (query) params.set('q', query);

  try {
    const res = await fetch(`/api/practitioner-roles?${params}`);
    const data = await parseResponseJson(res, '/api/practitioner-roles');
    if (!res.ok) throw new Error(data?.error || 'Failed to load practitioner roles');

    applyPractitionerRolesData(data);
    return true;
  } catch (err) {
    if (!silent || !(state.practitionerRoles.items || []).length) {
      body.innerHTML = `<tr><td colspan="6" class="placeholder">${escapeHtml(err.message)}</td></tr>`;
      const meta = $('#practitionerRolesMeta');
      if (meta) meta.textContent = '-';
    }
    if (subtitle && !silent) {
      subtitle.textContent = 'Could not load practitioner roles';
    }
    showToast(err.message, 'err', { title: 'Practitioner Roles' });
    return false;
  }
}

function sortPractitionerRolesNewestFirst(roles) {
  return [...roles].sort((a, b) => {
    const fhirB = Number(b.fhirId);
    const fhirA = Number(a.fhirId);
    const fb = Number.isFinite(fhirB) ? fhirB : -1;
    const fa = Number.isFinite(fhirA) ? fhirA : -1;
    if (fb !== fa) return fb - fa;
    const tb = Math.max(
      Date.parse(b.updatedAt || '') || 0,
      Date.parse(b.createdAt || '') || 0,
      Date.parse(b.syncedAt || '') || 0
    );
    const ta = Math.max(
      Date.parse(a.updatedAt || '') || 0,
      Date.parse(a.createdAt || '') || 0,
      Date.parse(a.syncedAt || '') || 0
    );
    if (tb !== ta) return tb - ta;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}

function samePractitionerRole(a, b) {
  if (!a || !b) return false;
  if (a.fhirId && b.fhirId && String(a.fhirId) === String(b.fhirId)) return true;
  if (a.id != null && b.id != null && Number(a.id) === Number(b.id)) return true;
  return false;
}

function practitionerRoleMatchesSearch(record, q) {
  if (!q) return true;
  const hay = [
    record.fhirId,
    record.practitionerName,
    record.practitionerFhirId,
    record.organizationName,
    record.organizationFhirId,
    record.prcId,
    record.roleDisplay,
    record.roleCode,
    record.prefix,
    record.givenName,
    record.familyName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(String(q).toLowerCase());
}

function rememberRecentPractitionerRole(record) {
  if (!record) return;
  const now = Date.now();
  const stamped = {
    ...record,
    createdAt: record.createdAt || new Date(now).toISOString(),
    updatedAt: record.updatedAt || new Date(now).toISOString(),
  };
  const kept = (state.practitionerRoles.recentCreates || []).filter(
    (x) => x.expiresAt > now && !samePractitionerRole(x.record, stamped)
  );
  kept.unshift({ record: stamped, expiresAt: now + 90_000 });
  state.practitionerRoles.recentCreates = kept.slice(0, 25);
}

function mergeRecentPractitionerRolesIntoState() {
  const now = Date.now();
  const recent = (state.practitionerRoles.recentCreates || []).filter((x) => x.expiresAt > now);
  state.practitionerRoles.recentCreates = recent;
  if (!recent.length) return;

  let items = [...(state.practitionerRoles.items || [])];
  for (const { record } of recent) {
    if (state.practitionerRoles.q && !practitionerRoleMatchesSearch(record, state.practitionerRoles.q)) {
      continue;
    }
    const idx = items.findIndex((r) => samePractitionerRole(r, record));
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...record, fhirId: record.fhirId || items[idx].fhirId };
    } else {
      items.unshift({
        ...record,
        source: record.fhirId ? 'fhir' : record.source || 'local',
      });
    }
  }
  state.practitionerRoles.items = sortPractitionerRolesNewestFirst(items);
}

function upsertPractitionerRoleRealtime(record, action = 'created') {
  if (!record) return false;
  const q = state.practitionerRoles.q;
  let items = [...(state.practitionerRoles.items || [])];
  const idx = items.findIndex((r) => samePractitionerRole(r, record));

  if (action === 'created') {
    if (q && !practitionerRoleMatchesSearch(record, q)) return false;
    if (idx >= 0) items.splice(idx, 1);
    items.unshift({
      ...record,
      source: record.fhirId ? 'fhir' : record.source || 'local',
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || new Date().toISOString(),
    });
    state.practitionerRoles.page = 1;
  } else if (idx >= 0) {
    items[idx] = { ...items[idx], ...record };
  } else if (!q || practitionerRoleMatchesSearch(record, q)) {
    items.unshift(record);
    state.practitionerRoles.page = 1;
  } else {
    return false;
  }

  state.practitionerRoles.items = sortPractitionerRolesNewestFirst(items);
  renderPractitionerRolesTable();
  return true;
}

let practitionerRolesReloadTimer = null;
function schedulePractitionerRolesReload({ silent = true, delay = 350 } = {}) {
  clearTimeout(practitionerRolesReloadTimer);
  practitionerRolesReloadTimer = setTimeout(() => {
    loadPractitionerRoles({ source: 'fhir', silent });
  }, delay);
}

function applyPractitionerRolesData(data) {
  const deduplicated = deduplicatePractitionerRolesList(data.roles || []);
  const sorted = sortPractitionerRolesNewestFirst(deduplicated);
  state.practitionerRoles.items = sorted;
  state.practitionerRoles.source = data.source || 'fhir';
  state.practitionerRoles.warning = data.warning || null;
  mergeRecentPractitionerRolesIntoState();
  renderPractitionerRolesTable();
}

function renderPractitionerRolesTable() {
  const body = $('#practitionerRolesBody');
  const subtitle = $('#practitionerRolesSubtitle');
  if (!body) return;

  const allRoles = state.practitionerRoles.items || [];
  const pageSize = state.practitionerRoles.pageSize;
  const total = allRoles.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const page = Math.min(Math.max(1, state.practitionerRoles.page), totalPages);
  const start = (page - 1) * pageSize;
  const roles = allRoles.slice(start, start + pageSize);
  const query = state.practitionerRoles.q;

  state.practitionerRoles.page = page;
  state.practitionerRoles.totalPages = totalPages;
  state.practitionerRoles.total = total;

  if (subtitle) {
    subtitle.textContent =
      state.practitionerRoles.source === 'fhir'
        ? state.practitionerRoles.warning || 'Practitioner roles from FHIR server (newest first)'
        : state.practitionerRoles.warning ||
          'Assign practitioners to facilities and manage specialty roles';
  }

  updateRolePager();

  if (!roles.length) {
    body.innerHTML = `<tr><td colspan="6" class="placeholder">${
      query ? 'No practitioner roles match your search' : 'No practitioner roles found'
    }</td></tr>`;
    return;
  }

  body.innerHTML = roles
    .map((r) => {
      const fhirId = r.fhirId || '-';
      const practitioner =
        r.practitionerName ||
        [r.prefix, r.givenName, r.familyName].filter(Boolean).join(' ') ||
        r.prcId ||
        '-';
      const organization = r.organizationName || r.organizationFhirId || '-';
      const roleLabel = r.roleDisplay || r.roleCode || '-';
      const isActive = r.active !== false;
      const isGolden = Boolean(r.isGolden);
      const goldenBadge = isGolden
        ? `<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;font-size:11px;font-weight:600;padding:1px 6px;border-radius:10px;margin-left:5px;" title="MDM Golden Master Record">🌟 Golden</span>`
        : '';
      return `<tr>
          <td><span class="cell-truncate" title="${escapeHtml(fhirId)}">${escapeHtml(fhirId)}</span></td>
          <td><span class="cell-ellipsis" title="${escapeHtml(practitioner)}">${escapeHtml(practitioner)}</span>${goldenBadge}</td>
          <td><span class="cell-ellipsis" title="${escapeHtml(organization)}">${escapeHtml(organization)}</span></td>
          <td><span class="role-badge" title="${escapeHtml(roleLabel)}">${escapeHtml(roleLabel)}</span></td>
          <td>
            <span class="status-indicator ${isActive ? 'is-active' : 'is-inactive'}">
              <span class="dot"></span>${isActive ? 'Active' : 'Inactive'}
            </span>
          </td>
          <td>${practitionerRoleActionButtons(r)}</td>
        </tr>`;
    })
    .join('');
}

async function fetchPatient({ id, fhirId }) {
  if (id) {
    const res = await fetch(`/api/patients/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load patient');
    return data;
  }
  if (fhirId) {
    const res = await fetch(`/api/patients/fhir/${encodeURIComponent(fhirId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load FHIR patient');
    return data;
  }
  throw new Error('Missing patient id');
}

function displayValue(value) {
  if (value == null || String(value).trim() === '') return '-';
  return String(value);
}

function syncChipClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'synced') return 'ok';
  if (s === 'pending') return 'warn';
  if (s === 'failed') return 'err';
  return '';
}

function detailItem(label, value, { full = false } = {}) {
  return `<div class="detail-item${full ? ' full' : ''}">
    <dt>${escapeHtml(label)}</dt>
    <dd>${escapeHtml(displayValue(value))}</dd>
  </div>`;
}

function psgcDisplayName(code, display) {
  const label = String(display || '').trim();
  if (label) {
    // Strip a leading PSGC code if the display already includes it.
    return label.replace(/^\d{6,}\s*[-:]\s*/, '').trim() || label;
  }
  return String(code || '').trim() || '-';
}

function detailSection(title, itemsHtml) {
  return `<section class="detail-section">
    <h3 class="detail-section-title">${escapeHtml(title)}</h3>
    <dl class="detail-grid">${itemsHtml}</dl>
  </section>`;
}

function setRecordMeta({
  kicker,
  title,
  subtitle,
  syncStatus,
  statusText,
  localCode,
  source,
  extraItems = [],
}) {
  const kickerEl = $('#recordViewKicker');
  if (kickerEl) kickerEl.textContent = kicker || 'Record';
  $('#recordViewTitle').textContent = title || 'Details';
  $('#recordViewSubtitle').textContent = subtitle || '-';

  const syncClass = syncChipClass(syncStatus);
  const parts = [
    `<span class="modal-meta-item ${syncClass}"><span class="dot"></span>${escapeHtml(
      displayValue(statusText ?? syncStatus)
    )}</span>`,
    localCode && localCode !== '-'
      ? `<span class="modal-meta-sep" aria-hidden="true"></span><span class="modal-meta-item">${escapeHtml(localCode)}</span>`
      : '',
    source
      ? `<span class="modal-meta-sep" aria-hidden="true"></span><span class="modal-meta-item muted">${escapeHtml(source)}</span>`
      : '',
    ...extraItems.filter(Boolean).map(
      (item) =>
        `<span class="modal-meta-sep" aria-hidden="true"></span><span class="modal-meta-item muted">${escapeHtml(item)}</span>`
    ),
  ].filter(Boolean);
  $('#recordViewChips').innerHTML = parts.join('');
}

function renderPatientModal(patient) {
  const name = [patient.givenName1, patient.givenName2, patient.familyName]
    .filter(Boolean)
    .join(' ');
  setRecordMeta({
    kicker: 'Patient record',
    title: name || 'Patient Details',
    subtitle: patient.fhirId
      ? `FHIR ID ${patient.fhirId}`
      : patient.localCode
        ? `Local code ${patient.localCode}`
        : 'Local patient record',
    syncStatus: patient.syncStatus,
    localCode: patient.localCode,
    source: patient.source,
  });

  state.recordView = {
    entity: 'patient',
    fhirId: patient.fhirId || null,
    historyLoaded: false,
    historyLoading: false,
  };

  const addressParts = [
    patient.addressLine,
    patient.barangayDisplay,
    patient.cityDisplay,
    patient.provinceDisplay,
    patient.regionDisplay,
    patient.postalCode,
  ].filter(Boolean);

  const detailsHtml = [
    detailSection(
      'Identifiers',
      [
        detailItem('PhilSys ID', patient.philsysId),
        detailItem('PhilHealth ID', patient.philhealthId),
        detailItem('Local Code', patient.localCode),
        detailItem('FHIR ID', patient.fhirId),
      ].join('')
    ),
    detailSection(
      'Demographics',
      [
        detailItem('Family Name', patient.familyName),
        detailItem('Given Name', patient.givenName1),
        detailItem('Middle / 2nd Given', patient.givenName2),
        detailItem('Gender', patient.gender),
        detailItem('Birth Date', patient.birthDate),
        detailItem('Mobile Phone', patient.phone),
      ].join('')
    ),
    detailSection(
      'Address (PSGC)',
      [
        detailItem('Address', addressParts.join(', ') || '-', { full: true }),
        detailItem('Region', psgcDisplayName(patient.regionCode, patient.regionDisplay)),
        detailItem('Province', psgcDisplayName(patient.provinceCode, patient.provinceDisplay)),
        detailItem('City', psgcDisplayName(patient.cityCode, patient.cityDisplay)),
        detailItem('Barangay', psgcDisplayName(patient.barangayCode, patient.barangayDisplay)),
        detailItem('Postal Code', patient.postalCode),
      ].join('')
    ),
    detailSection(
      'Next of Kin',
      [
        detailItem('Family Name', patient.nextOfKinFamily),
        detailItem('Given Name', patient.nextOfKinGiven),
      ].join('')
    ),
  ].join('');

  const historyHint = patient.fhirId
    ? `<p class="muted patient-history-hint">Loading revision history from FHIR...</p>
       <div class="patient-history-mount" id="patientHistoryMount"></div>`
    : `<p class="muted">Revision history is available after this patient is synced to FHIR.</p>`;

  $('#recordViewBody').innerHTML = `
    <div class="record-tabs" role="tablist" aria-label="Patient record sections">
      <button type="button" class="record-tab active" role="tab" aria-selected="true" data-record-tab="details">Details</button>
      <button type="button" class="record-tab" role="tab" aria-selected="false" data-record-tab="history" ${
        patient.fhirId ? '' : 'disabled title="Requires a FHIR ID"'
      }>History</button>
    </div>
    <div class="record-tab-panel active" data-record-panel="details" role="tabpanel">
      ${detailsHtml}
    </div>
    <div class="record-tab-panel" data-record-panel="history" role="tabpanel" hidden>
      ${historyHint}
    </div>
  `;
}

function setRecordTab(tabName) {
  const modal = $('#recordViewModal');
  if (!modal) return;
  const tabs = [...modal.querySelectorAll('[data-record-tab]')];
  const panels = [...modal.querySelectorAll('[data-record-panel]')];
  tabs.forEach((tab) => {
    const active = tab.dataset.recordTab === tabName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  panels.forEach((panel) => {
    const active = panel.dataset.recordPanel === tabName;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
}

function renderPatientHistoryTimeline(timeline = []) {
  if (!timeline.length) {
    return `<p class="muted">No Patient history versions returned from FHIR.</p>`;
  }

  const items = timeline
    .map((row, index) => {
      const when = formatDateTime(row.lastUpdated) || '-';
      const action = displayValue(row.action || (index === timeline.length - 1 ? 'Created' : 'Updated'));
      const version = row.versionId ? `v${escapeHtml(String(row.versionId))}` : '';
      const name = row.displayName
        ? `<p class="timeline-note">${escapeHtml(row.displayName)}</p>`
        : '';
      const changeRows = (row.changes || [])
        .map(
          (change) => `<li><strong>${escapeHtml(change.field)}</strong>:
            <span class="muted">${escapeHtml(displayValue(change.from))}</span>
            to
            <span>${escapeHtml(displayValue(change.to))}</span></li>`
        )
        .join('');
      const changes = changeRows
        ? `<ul class="timeline-changes">${changeRows}</ul>`
        : index === timeline.length - 1
          ? `<p class="timeline-note muted">Initial version</p>`
          : `<p class="timeline-note muted">No field-level changes detected</p>`;

      return `<li class="status-timeline-item">
        <div class="status-timeline-dot" aria-hidden="true"></div>
        <div class="status-timeline-card">
          <div class="status-timeline-head">
            <strong>${escapeHtml(action)}</strong>
            <span class="timeline-pill">${escapeHtml(when)}</span>
            ${version ? `<span class="muted">${version}</span>` : ''}
          </div>
          ${name}
          ${changes}
        </div>
      </li>`;
    })
    .join('');

  return `<ol class="status-timeline">${items}</ol>`;
}

async function loadPatientHistory({ quiet = false } = {}) {
  const fhirId = String(state.recordView?.fhirId || '').trim();
  const mount = $('#patientHistoryMount');
  if (!fhirId) {
    if (!quiet) {
      showToast('No FHIR ID available for patient history.', 'warn', { title: 'History' });
    }
    return;
  }
  if (!mount) return;
  if (state.recordView.historyLoading) return;

  state.recordView.historyLoading = true;
  mount.innerHTML = `<p class="muted">Loading revision history from FHIR...</p>`;
  const hint = document.querySelector('.patient-history-hint');
  if (hint) hint.hidden = true;

  try {
    const res = await fetch(`/api/patients/fhir/${encodeURIComponent(fhirId)}/history?count=50`);
    const data = await parseResponseJson(res, '/api/patients/fhir/.../history');
    if (!res.ok) throw new Error(data?.error || 'Failed to load patient history');

    const timeline = data.timeline || [];
    state.recordView.historyLoaded = true;
    mount.innerHTML = `
      <div class="patient-history-summary">
        <strong>${timeline.length}</strong> revision${timeline.length === 1 ? '' : 's'} from FHIR
        <code>Patient/${escapeHtml(fhirId)}/_history</code>
      </div>
      ${renderPatientHistoryTimeline(timeline)}
    `;
  } catch (err) {
    mount.innerHTML = `<p class="placeholder">${escapeHtml(err.message)}</p>`;
    if (!quiet) showToast(err.message, 'err', { title: 'History' });
  } finally {
    state.recordView.historyLoading = false;
  }
}

function renderOrganizationModal(org) {
  state.recordView = {
    entity: 'organization',
    fhirId: org.fhirId || null,
    historyLoaded: false,
    historyLoading: false,
  };
  setRecordMeta({
    kicker: 'Organization record',
    title: org.name || 'Organization Details',
    subtitle: org.fhirId
      ? `FHIR ID ${org.fhirId}`
      : org.localCode
        ? `Local code ${org.localCode}`
        : 'Organization record',
    syncStatus: org.syncStatus,
    localCode: org.localCode,
    source: org.source,
  });

  const addressParts = [
    org.addressLine,
    org.barangayDisplay,
    org.cityDisplay,
    org.provinceDisplay,
    org.regionDisplay,
    org.postalCode,
  ].filter(Boolean);

  $('#recordViewBody').innerHTML = [
    detailSection(
      'Facility',
      [
        detailItem('Name', org.name, { full: true }),
        detailItem('NHFR Code', org.nhfrCode),
        detailItem('HCPN', org.hcpnCode),
        detailItem('Phone', org.phone),
        detailItem('Local Code', org.localCode),
        detailItem('FHIR ID', org.fhirId),
      ].join('')
    ),
    detailSection(
      'Address (PSGC)',
      [
        detailItem('Address', addressParts.join(', ') || '-', { full: true }),
        detailItem('Region', psgcDisplayName(org.regionCode, org.regionDisplay)),
        detailItem('Province', psgcDisplayName(org.provinceCode, org.provinceDisplay)),
        detailItem('City', psgcDisplayName(org.cityCode, org.cityDisplay)),
        detailItem('Barangay', psgcDisplayName(org.barangayCode, org.barangayDisplay)),
        detailItem('Postal Code', org.postalCode),
      ].join('')
    ),
  ].join('');
}

function closeRecordModal() {
  const modal = $('#recordViewModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
}

function openRecordModal() {
  const modal = $('#recordViewModal');
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function openPatientModal(patient) {
  renderPatientModal(patient);
  openRecordModal();
}

function openOrganizationModal(org) {
  renderOrganizationModal(org);
  openRecordModal();
}

function renderPractitionerModal(prac) {
  state.recordView = {
    entity: 'practitioner',
    fhirId: prac.fhirId || null,
    historyLoaded: false,
    historyLoading: false,
  };
  const name = [prac.prefix, prac.givenName, prac.familyName].filter(Boolean).join(' ') || 'Practitioner Details';
  setRecordMeta({
    kicker: 'Practitioner record',
    title: name,
    subtitle: prac.fhirId
      ? `FHIR ID ${prac.fhirId}`
      : prac.localCode
        ? `Local code ${prac.localCode}`
        : 'Practitioner record',
    syncStatus: prac.syncStatus,
    localCode: prac.localCode,
    source: prac.source,
  });

  $('#recordViewBody').innerHTML = [
    detailSection(
      'Clinician',
      [
        detailItem('Prefix', prac.prefix),
        detailItem('Given Name', prac.givenName),
        detailItem('Family Name', prac.familyName),
        detailItem('PRC License No.', prac.prcId),
        detailItem('Phone', prac.phone),
        detailItem('Local Code', prac.localCode),
        detailItem('FHIR ID', prac.fhirId),
      ].join('')
    ),
    detailSection(
      'Practitioner Role',
      [
        detailItem('Role Code', prac.roleCode),
        detailItem('Role Display', prac.roleDisplay),
        detailItem('Role FHIR ID', prac.roleFhirId),
        detailItem('Organization FHIR ID', prac.organizationFhirId),
      ].join('')
    ),
  ].join('');
}

function openPractitionerModal(prac) {
  renderPractitionerModal(prac);
  openRecordModal();
}

async function deleteEntity(entity, { id, fhirId }) {
  const labels = {
    patient: 'patient',
    organization: 'organization',
    practitioner: 'practitioner',
    'practitioner-role': 'practitioner role',
  };
  const label = labels[entity] || 'record';
  const confirmed = window.confirm(
    `Delete this ${label}? This removes it locally and attempts to delete it from the FHIR server.`
  );
  if (!confirmed) return;

  const base =
    entity === 'organization'
      ? '/api/organizations'
      : entity === 'practitioner'
        ? '/api/practitioners'
        : entity === 'practitioner-role'
          ? '/api/practitioner-roles'
          : '/api/patients';
  const url = id
    ? `${base}/${encodeURIComponent(id)}`
    : `${base}/fhir/${encodeURIComponent(fhirId)}`;

  const res = await fetch(url, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Could not delete ${label}`);

  if (data.fhirWarning) {
    showToast(
      `Removed locally. FHIR warning: ${data.fhirWarning}`,
      'err',
      { title: `${label[0].toUpperCase()}${label.slice(1)} deleted` }
    );
  } else {
    showToast(`${label[0].toUpperCase()}${label.slice(1)} deleted`, 'ok', {
      title: 'Deleted',
    });
  }

  if (entity === 'organization') {
    await loadOrganizations({ source: 'fhir' });
  } else if (entity === 'practitioner') {
    await loadPractitioners({ source: 'fhir' });
  } else if (entity === 'practitioner-role') {
    await loadPractitionerRoles({ source: 'fhir' });
  } else {
    await loadPatients();
    loadDashboard();
  }
}

async function openPatient(mode, { id, fhirId }) {
  try {
    const patient = await fetchPatient({ id, fhirId });

    if (mode === 'view') {
      openPatientModal(patient);
      return;
    }

    state.formMode = 'edit';
    fillPatientForm(patient);
    setFormReadonly(false);

    $('#patientFormTitle').textContent = 'Edit Patient';
    $('#patientFormSubtitle').textContent = patient.id
      ? 'Updates local record and syncs to FHIR'
      : 'Updates patient on FHIR server';
    $('#savePatientBtn').hidden = false;
    setSaveButtonLabel($('#savePatientBtn'), 'Save');
    $('#patientFormAlert').hidden = true;

    setView('patient-form');
  } catch (err) {
    showToast(err.message, 'err', { title: 'Patient' });
  }
}

async function fetchOrganization({ id, fhirId }) {
  if (id) {
    const res = await fetch(`/api/organizations/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load organization');
    return data;
  }
  if (fhirId) {
    const res = await fetch(`/api/organizations/fhir/${encodeURIComponent(fhirId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load organization');
    return data;
  }
  throw new Error('Missing organization id');
}

function resetOrganizationForm() {
  const form = $('#organizationForm');
  if (!form) return;
  form.reset();
  state.orgFormMode = 'create';
  $('#organizationEditId').value = '';
  $('#organizationEditFhirId').value = '';
  $('#organizationFormTitle').textContent = 'Add Organization';
  $('#organizationFormSubtitle').textContent = 'Saved locally, then PUT to FHIR by NHFR identifier';
  $('#organizationFormAlert').hidden = false;
  $('#saveOrganizationBtn').hidden = false;
  setSaveButtonLabel($('#saveOrganizationBtn'), 'Save');
  setOrgFormReadonly(false);
  seedOrganizationIds(form);
  form.dataset.seeded = '1';
}

function setOrgFormReadonly(readonly) {
  const form = $('#organizationForm');
  if (!form) return;
  [...form.elements].forEach((el) => {
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
    if (el.classList?.contains('psgc-select')) return;
    el.disabled = readonly;
  });
  if (window.PsgcSelect) PsgcSelect.setReadonly('#organizationForm', readonly);
}

function fillOrganizationForm(o) {
  const form = $('#organizationForm');
  const fields = ['name', 'nhfrCode', 'hcpnCode', 'phone', 'addressLine', 'postalCode'];
  fields.forEach((name) => {
    if (form[name]) form[name].value = o[name] || '';
  });
  $('#organizationEditId').value = o.id || '';
  $('#organizationEditFhirId').value = o.fhirId || '';
  if (window.PsgcSelect) {
    PsgcSelect.setFormValues('#organizationForm', {
      regionCode: o.regionCode,
      regionDisplay: o.regionDisplay,
      provinceCode: o.provinceCode,
      provinceDisplay: o.provinceDisplay,
      cityCode: o.cityCode,
      cityDisplay: o.cityDisplay,
      barangayCode: o.barangayCode,
      barangayDisplay: o.barangayDisplay,
    });
  } else {
    [
      'regionCode',
      'regionDisplay',
      'provinceCode',
      'provinceDisplay',
      'cityCode',
      'cityDisplay',
      'barangayCode',
      'barangayDisplay',
    ].forEach((name) => {
      if (form[name]) form[name].value = o[name] || '';
    });
  }
  form.dataset.seeded = '1';
}

async function openOrganization(mode, { id, fhirId }) {
  try {
    const organization = await fetchOrganization({ id, fhirId });

    if (mode === 'view') {
      openOrganizationModal(organization);
      return;
    }

    state.orgFormMode = 'edit';
    fillOrganizationForm(organization);
    setOrgFormReadonly(false);

    $('#organizationFormTitle').textContent = 'Edit Organization';
    $('#organizationFormSubtitle').textContent = organization.id
      ? 'Updates local record and syncs to FHIR'
      : 'Updates organization on FHIR server';
    $('#saveOrganizationBtn').hidden = false;
    setSaveButtonLabel($('#saveOrganizationBtn'), 'Save');
    $('#organizationFormAlert').hidden = true;

    setView('organization-form');
  } catch (err) {
    showToast(err.message, 'err', { title: 'Organization' });
  }
}

async function fetchPractitioner({ id, fhirId }) {
  if (id) {
    const res = await fetch(`/api/practitioners/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load practitioner');
    return data;
  }
  if (fhirId) {
    const res = await fetch(`/api/practitioners/fhir/${encodeURIComponent(fhirId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load practitioner');
    return data;
  }
  throw new Error('Missing practitioner id');
}

function resetPractitionerForm() {
  const form = $('#practitionerForm');
  if (!form) return;
  form.reset();
  state.pracFormMode = 'create';
  $('#practitionerEditId').value = '';
  $('#practitionerEditFhirId').value = '';
  if ($('#practitionerEditRoleFhirId')) $('#practitionerEditRoleFhirId').value = '';
  $('#practitionerFormTitle').textContent = 'Add Practitioner & Role';
  $('#practitionerFormSubtitle').textContent = 'Submits Practitioner and PractitionerRole atomically as a FHIR Transaction Bundle';
  $('#practitionerFormAlert').hidden = false;
  $('#savePractitionerBtn').hidden = false;
  setSaveButtonLabel($('#savePractitionerBtn'), 'Save as FHIR Bundle');
  setPracFormReadonly(false);
  seedPractitionerIds(form);
  form.dataset.seeded = '1';
  populateFacilityDropdown($('#practitionerFormOrgSelect'), defaultFacilityFhirId());
  setRoleSpecialtyValue(form, DEFAULT_ROLE_CODE, DEFAULT_ROLE_DISPLAY, DEFAULT_ROLE_SYSTEM);
}

function setPracFormReadonly(readonly) {
  const form = $('#practitionerForm');
  if (!form) return;
  [...form.elements].forEach((el) => {
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
    el.disabled = readonly;
  });
}

function fillPractitionerForm(p) {
  const form = $('#practitionerForm');
  const fields = [
    'prefix',
    'givenName',
    'familyName',
    'gender',
    'prcId',
    'phone',
    'roleCode',
    'roleDisplay',
    'organizationFhirId',
  ];
  fields.forEach((name) => {
    if (form[name]) form[name].value = p[name] || '';
  });
  if (form.roleCode && !form.roleCode.value) form.roleCode.value = DEFAULT_ROLE_CODE;
  if (form.roleDisplay && !form.roleDisplay.value) form.roleDisplay.value = DEFAULT_ROLE_DISPLAY;
  if (form.roleSystem && !form.roleSystem.value) form.roleSystem.value = DEFAULT_ROLE_SYSTEM;
  $('#practitionerEditId').value = p.id || '';
  $('#practitionerEditFhirId').value = p.fhirId || '';
  if ($('#practitionerEditRoleFhirId')) {
    $('#practitionerEditRoleFhirId').value = p.roleFhirId || '';
  }
  form.dataset.seeded = '1';
  populateFacilityDropdown(
    $('#practitionerFormOrgSelect'),
    p.organizationFhirId || defaultFacilityFhirId()
  );
  setRoleSpecialtyValue(
    form,
    p.roleCode || DEFAULT_ROLE_CODE,
    p.roleDisplay || DEFAULT_ROLE_DISPLAY,
    p.roleSystem || DEFAULT_ROLE_SYSTEM
  );
}

async function openPractitioner(mode, { id, fhirId }) {
  try {
    const practitioner = await fetchPractitioner({ id, fhirId });

    if (mode === 'view') {
      openPractitionerModal(practitioner);
      return;
    }

    state.pracFormMode = 'edit';
    fillPractitionerQuickForm(practitioner);
    openPractitionerQuickModal('edit');
  } catch (err) {
    showToast(err.message, 'err', { title: 'Practitioner' });
  }
}

const ROLE_CODE_DISPLAYS = {
  '158965000': 'Doctor',
  '265937000': 'Nurse',
  '309453006': 'Midwife',
  '46255001': 'Pharmacist',
  '386629007': 'Medical Technologist',
  '159282002': 'Laboratory Aide',
  '106289002': 'Dentist',
  '4162009': 'Dental Aide',
  '28229004': 'Optometrist',
  '3253': 'Barangay health worker',
  PCW: 'Primary Care Worker',
};

function renderPractitionerRoleModal(role) {
  const name =
    role.practitionerName ||
    [role.prefix, role.givenName, role.familyName].filter(Boolean).join(' ') ||
    role.roleDisplay ||
    'Practitioner Role';
  setRecordMeta({
    kicker: 'Practitioner role',
    title: name,
    subtitle: role.fhirId
      ? `FHIR ID ${role.fhirId}`
      : role.localCode
        ? `Local code ${role.localCode}`
        : 'Practitioner role record',
    syncStatus: role.syncStatus,
    localCode: role.localCode,
    source: role.source,
    statusText: role.active === false ? 'Inactive' : role.syncStatus || 'Active',
  });

  $('#recordViewBody').innerHTML = [
    detailSection(
      'Assignment',
      [
        detailItem('Practitioner', role.practitionerName || [role.prefix, role.givenName, role.familyName].filter(Boolean).join(' ')),
        detailItem('Practitioner FHIR ID', role.practitionerFhirId),
        detailItem('PRC License No.', role.prcId),
        detailItem('Organization', role.organizationName),
        detailItem('Organization FHIR ID', role.organizationFhirId),
      ].join('')
    ),
    detailSection(
      'Role / Specialty',
      [
        detailItem('Role Code', role.roleCode),
        detailItem('Role Display', role.roleDisplay),
        detailItem('Status', role.active === false ? 'Inactive' : 'Active'),
        detailItem('Local Code', role.localCode),
        detailItem('FHIR ID', role.fhirId),
      ].join('')
    ),
  ].join('');
}

function openPractitionerRoleModal(role) {
  renderPractitionerRoleModal(role);
  openRecordModal();
}

async function fetchPractitionerRole({ id, fhirId }) {
  if (id) {
    const res = await fetch(`/api/practitioner-roles/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load practitioner role');
    return data;
  }
  if (fhirId) {
    const res = await fetch(`/api/practitioner-roles/fhir/${encodeURIComponent(fhirId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load FHIR practitioner role');
    return data;
  }
  throw new Error('Missing practitioner role id');
}

async function preparePractitionerRoleFormLookups({
  preferredPractitioner = '',
  preferredOrganization = '',
  preferredRoleCode = '',
  preferredRoleDisplay = '',
  preferredRoleSystem = '',
} = {}) {
  const pracSelect = $('#rolePractitionerSelect') || $('#rolePractitionerSelectLegacy');
  const orgSelect = $('#roleOrganizationSelect') || $('#roleOrganizationSelectLegacy');
  const specialtySelects = [$('#roleSpecialtySelect'), $('#roleSpecialtySelectLegacy')].filter(
    Boolean
  );
  if (!pracSelect) return;

  const setLoading = (select, label) => {
    destroySearchableSelect(select);
    select.innerHTML = `<option value="">${label}</option>`;
    initSearchableSelect(select, { force: true });
  };
  setLoading(pracSelect, 'Loading practitioners...');
  if (orgSelect) setLoading(orgSelect, 'Loading organizations...');

  try {
    const [pracsRes, orgsRes] = await Promise.all([
      fetch('/api/practitioners?source=fhir&count=200&includeRoles=false'),
      fetch('/api/organizations?source=fhir&count=200'),
    ]);
    const pracsData = await pracsRes.json().catch(() => ({ practitioners: [] }));
    const orgsData = await orgsRes.json().catch(() => ({ organizations: [] }));

    const practitioners = (pracsData.practitioners || []).filter((p) => p.fhirId);
    const organizations = (orgsData.organizations || []).filter((o) => o.fhirId);

    state.practitionerRoles.lookups = {
      practitioners,
      organizations,
      roleCodes: state.practitionerRoles.lookups.roleCodes || [],
      loaded: true,
    };

    fillSelect(pracSelect, practitioners, {
      valueKey: 'fhirId',
      preferredValue: preferredPractitioner,
      placeholder: practitioners.length
        ? '-- Select Practitioner --'
        : 'No practitioners with FHIR ID',
      labelFn: (p) => {
        const name = [p.prefix, p.givenName, p.familyName].filter(Boolean).join(' ') || 'Practitioner';
        return `${name}${p.prcId && p.prcId !== '-' ? ` (${p.prcId})` : ''}`;
      },
    });

    if (orgSelect) {
      fillSelect(orgSelect, organizations, {
        valueKey: 'fhirId',
        preferredValue: preferredOrganization || defaultFacilityFhirId(),
        placeholder: organizations.length
          ? '-- Select Organization --'
          : 'No organizations with FHIR ID',
        labelFn: (o) =>
          `${o.name || '-'}${o.nhfrCode && o.nhfrCode !== '-' ? ` (${o.nhfrCode})` : ''}`,
      });
    }

    specialtySelects.forEach((select) => {
      const form = select.closest('form');
      if (form) {
        setRoleSpecialtyValue(
          form,
          preferredRoleCode || DEFAULT_ROLE_CODE,
          preferredRoleDisplay || DEFAULT_ROLE_DISPLAY,
          preferredRoleSystem || DEFAULT_ROLE_SYSTEM
        );
      } else {
        initRoleSpecialtySelect(select, { force: true });
      }
    });

    syncRoleFormHiddenFields();
    syncRoleQuickHiddenFields();
  } catch (err) {
    showToast(err.message, 'err', { title: 'Role form lookups' });
  }
}

function syncRoleFormHiddenFields() {
  const form = $('#practitionerRoleQuickForm') || $('#practitionerRoleForm');
  if (!form) return;
  syncRoleSpecialtyHidden(form);
  const pracId = form.practitionerFhirId?.value || '';
  const orgId = form.organizationFhirId?.value || '';
  const prac = (state.practitionerRoles.lookups.practitioners || []).find(
    (p) => String(p.fhirId) === String(pracId)
  );
  const org = (state.practitionerRoles.lookups.organizations || []).find(
    (o) => String(o.fhirId) === String(orgId)
  );

  if (form.prcId) {
    form.prcId.value = prac?.prcId && prac.prcId !== '-' ? prac.prcId : form.prcId.value || '';
  }
  if (form.practitionerName) {
    form.practitionerName.value = prac
      ? [prac.prefix, prac.givenName, prac.familyName].filter(Boolean).join(' ')
      : form.practitionerName.value || '';
  }
  if (form.organizationName) {
    form.organizationName.value = org?.name || form.organizationName.value || '';
  }
}

function seedPractitionerRoleDefaults(form) {
  if (!form) return;
  setRoleSpecialtyValue(form, DEFAULT_ROLE_CODE, DEFAULT_ROLE_DISPLAY, DEFAULT_ROLE_SYSTEM);
  if (form.active) {
    form.active.value = 'true';
    syncSearchableSelect(form.active);
  }
}

function resetPractitionerRoleForm() {
  const form = $('#practitionerRoleForm');
  if (!form) return;
  form.reset();
  state.roleFormMode = 'create';
  $('#practitionerRoleEditId').value = '';
  $('#practitionerRoleEditFhirId').value = '';
  $('#practitionerRoleFormTitle').textContent = 'Add Practitioner Role';
  $('#practitionerRoleFormSubtitle').textContent =
    'Link a practitioner to a facility with a clinical specialty role';
  $('#practitionerRoleFormAlert').hidden = false;
  $('#savePractitionerRoleBtn').hidden = false;
  setSaveButtonLabel($('#savePractitionerRoleBtn'), 'Save Role Assignment');
  setRoleFormReadonly(false);
  seedPractitionerRoleDefaults(form);
  preparePractitionerRoleFormLookups({
    preferredOrganization: defaultFacilityFhirId(),
  });
}

function setRoleFormReadonly(readonly) {
  const form = $('#practitionerRoleForm');
  if (!form) return;
  [...form.elements].forEach((el) => {
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
    el.disabled = readonly;
    if (el.tagName === 'SELECT') syncSearchableSelect(el);
  });
}

function fillPractitionerRoleForm(role) {
  const form = $('#practitionerRoleForm');
  if (!form) return;
  setRoleSpecialtyValue(form, role.roleCode, role.roleDisplay, role.roleSystem);
  if (form.active) {
    form.active.value = role.active === false ? 'false' : 'true';
    syncSearchableSelect(form.active);
  }
  if (form.prcId) form.prcId.value = role.prcId && role.prcId !== '-' ? role.prcId : '';
  if (form.practitionerName) form.practitionerName.value = role.practitionerName || '';
  if (form.organizationName) form.organizationName.value = role.organizationName || '';
  $('#practitionerRoleEditId').value = role.id || '';
  $('#practitionerRoleEditFhirId').value = role.fhirId || '';
}

async function openPractitionerRole(mode, { id, fhirId }) {
  try {
    const role = await fetchPractitionerRole({ id, fhirId });

    if (mode === 'view') {
      openPractitionerRoleModal(role);
      return;
    }

    state.roleFormMode = 'edit';
    fillPractitionerRoleQuickForm(role);
    openPractitionerRoleQuickModal('edit');
  } catch (err) {
    showToast(err.message, 'err', { title: 'Practitioner Role' });
  }
}

function renderSyncMonitor() {
  const h = state.health;
  const d = state.dashboard;
  $('#syncMonitorCard').innerHTML = `
    <div class="status-row"><span>Local Database</span><strong>${h?.localDb?.status || 'unknown'}</strong></div>
    <div class="status-row"><span>FHIR Server</span><strong>${h?.fhir?.status || 'unknown'}</strong></div>
    <div class="status-row"><span>Terminology (PSGC)</span><strong>${h?.terminology?.status || 'unknown'}</strong></div>
    <div class="status-row"><span>FHIR Base URL</span><code>${h?.fhir?.baseUrl || '-'}</code></div>
    <div class="status-row"><span>TX Base URL</span><code>${h?.terminology?.baseUrl || '-'}</code></div>
    <div class="grid-3" style="margin-top:1rem;">
      <div class="metric warn"><div class="num">${d?.sync?.pending ?? '-'}</div><div class="lbl">Pending</div></div>
      <div class="metric err"><div class="num">${d?.sync?.failed ?? '-'}</div><div class="lbl">Failed</div></div>
      <div class="metric ok"><div class="num">${d?.sync?.synced ?? '-'}</div><div class="lbl">Synced</div></div>
    </div>
    ${h?.localDb?.message ? `<p class="muted">DB: ${escapeHtml(h.localDb.message)}</p>` : ''}
    ${h?.fhir?.message ? `<p class="muted">FHIR: ${escapeHtml(h.fhir.message)}</p>` : ''}
    ${h?.terminology?.message ? `<p class="muted">TX: ${escapeHtml(h.terminology.message)}</p>` : ''}
  `;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function toLocalDateTimeValue(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalDateTimeValue(value) {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function destroySearchableSelect(el) {
  const $el = window.jQuery?.(el);
  if ($el?.length && $el.data('select2')) {
    $el.off('.searchableSelect');
    $el.select2('destroy');
  }
}

function syncSearchableSelect(el) {
  if (!el || !window.jQuery) return;
  const $el = jQuery(el);
  if (!$el.data('select2')) return;
  $el.prop('disabled', Boolean(el.disabled));
  $el.trigger('change.select2');
}

function initSearchableSelect(el, { force = false } = {}) {
  if (!el || !window.jQuery || !jQuery.fn.select2) return;
  const $el = jQuery(el);
  if ($el.hasClass('psgc-select') || $el.hasClass('diagnosis-select') || $el.hasClass('role-specialty-select')) return;

  if ($el.data('select2')) {
    if (!force) {
      syncSearchableSelect(el);
      return;
    }
    destroySearchableSelect(el);
  }

  const blankOption = [...el.options].find((o) => o.value === '');
  const placeholder =
    $el.data('placeholder') ||
    el.getAttribute('aria-label') ||
    (blankOption?.textContent || '').trim() ||
    'Select...';
  const inToolbar = Boolean($el.closest('.inbox-toolbar, .table-toolbar').length);
  const stretch = $el.is('#inboxReceivingFacilityFilter');

  $el.select2({
    width: stretch || !inToolbar ? '100%' : 'style',
    placeholder,
    allowClear: !el.required,
    minimumResultsForSearch: 0,
    dropdownParent: jQuery('body'),
  });
  $el.prop('disabled', Boolean(el.disabled));
}

function initAllSearchableSelects(root = document) {
  if (!window.jQuery || !jQuery.fn.select2) return;
  jQuery(root)
    .find('select')
    .not('.psgc-select, .diagnosis-select, .role-specialty-select')
    .each((_, el) => initSearchableSelect(el));
}

function fillSelect(
  select,
  items,
  { valueKey = 'id', labelFn, placeholder = 'Select...', preferredValue = '' } = {}
) {
  if (!select) return;
  const previous = select.value;
  destroySearchableSelect(select);
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = String(item[valueKey]);
    opt.textContent = labelFn(item);
    select.appendChild(opt);
  }
  const preferred = String(preferredValue || '').trim();
  if (previous && [...select.options].some((o) => o.value === previous)) {
    select.value = previous;
  } else if (preferred && [...select.options].some((o) => o.value === preferred)) {
    select.value = preferred;
  }
  initSearchableSelect(select, { force: true });
}

async function prepareReferralForm({ quiet = false } = {}) {
  const form = $('#referralForm');
  if (!form) return;

  const sendingOrgSelect = $('#referralSendingOrgId');
  const receivingOrgSelect = $('#referralReceivingOrgId');
  const sendingPracSelect = $('#referralSendingPracId');
  const receivingPracSelect = $('#referralReceivingPracId');
  const categorySelect = $('#referralCategoryCode');
  const setLoadingSelect = (select, label) => {
    if (!select || select.value) return;
    destroySearchableSelect(select);
    select.innerHTML = `<option value="">${label}</option>`;
    initSearchableSelect(select, { force: true });
  };
  setLoadingSelect(sendingOrgSelect, 'Loading facilities from FHIR...');
  setLoadingSelect(receivingOrgSelect, 'Loading facilities from FHIR...');
  setLoadingSelect(sendingPracSelect, 'Select facility first...');
  setLoadingSelect(receivingPracSelect, 'Select facility first...');
  setLoadingSelect(categorySelect, 'Loading referral priorities...');
  state.referralLookups.patientsLoading = true;

  try {
    const [patientsRes, orgsRes, categoriesRes] = await Promise.all([
      fetch('/api/patients?source=fhir&count=200'),
      fetch('/api/organizations?source=fhir&count=200'),
      fetch('/api/psgc/referral-categories'),
    ]);
    const patientsData = await patientsRes.json();
    const orgsData = await orgsRes.json().catch(() => ({ organizations: [] }));
    const categoriesData = await categoriesRes.json().catch(() => ({ results: [] }));

    if (!patientsRes.ok) throw new Error(patientsData.error || 'Could not load patients');

    // Prefer FHIR patients (local DB may be disabled / empty).
    const patients = (patientsData.patients || []).filter((p) => p.fhirId || p.id);

    const byFhirId = new Map();
    const mergeOrg = (o) => {
      if (!o) return;
      if (o.fhirId) {
        const prev = byFhirId.get(o.fhirId) || {};
        byFhirId.set(o.fhirId, {
          ...prev,
          ...o,
          fhirId: o.fhirId,
          id: o.id || prev.id || null,
          name: o.name || prev.name || '-',
          nhfrCode: o.nhfrCode || prev.nhfrCode || null,
        });
        return;
      }
      if (o.id) {
        byFhirId.set(`local-${o.id}`, { ...o });
      }
    };

    if (orgsRes.ok) {
      (orgsData.organizations || []).forEach(mergeOrg);
    } else if (!quiet) {
      showToast(orgsData.error || 'Could not load facilities from FHIR', 'warn', {
        title: 'Facilities',
      });
    }

    const organizations = [...byFhirId.values()]
      .filter((o) => o.fhirId || o.id)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    state.referralLookups = {
      patients,
      patientsLoaded: true,
      patientsLoading: false,
      organizations,
      practitioners: state.referralLookups.practitionerRoles || [],
      practitionerRoles: state.referralLookups.practitionerRoles || [],
      rolesWarnShown: state.referralLookups.rolesWarnShown || false,
    };

    const wasSeeded = Boolean(form.dataset.seeded);
    if (!wasSeeded) {
      form.reset();
      resetWorkingImpressionSelect();
      initAllSearchableSelects(form);
    }

    // Init after reset so Select2 ajax stays bound to a clean empty option.
    initWorkingImpressionSelect({ force: true });

    if (!wasSeeded) {
      clearReferralPatientPicker();
    } else {
      const selectedFhir = $('#referralPatientFhirId')?.value;
      const selectedId = $('#referralPatientId')?.value;
      const selected = patients.find(
        (p) =>
          (selectedFhir && String(p.fhirId) === String(selectedFhir)) ||
          (selectedId && String(p.id) === String(selectedId))
      );
      if (selected) setReferralPatient(selected);
      else clearReferralPatientPicker();
    }

    const facilityOptions = organizations.filter((o) => o.fhirId);
    const homeFacilityId = typeof defaultFacilityFhirId === 'function' ? defaultFacilityFhirId() : '';
    fillSelect(sendingOrgSelect, facilityOptions, {
      valueKey: 'fhirId',
      preferredValue: homeFacilityId,
      placeholder: facilityOptions.length
        ? 'Select sending facility...'
        : orgsRes.ok
          ? 'No facilities returned from FHIR'
          : 'Could not load facilities from FHIR',
      labelFn: (o) =>
        `${o.name || '-'}${o.nhfrCode && o.nhfrCode !== '-' ? ` (${o.nhfrCode})` : ''}${
          o.id ? '' : ' · FHIR'
        }`,
    });
    fillSelect(receivingOrgSelect, facilityOptions, {
      valueKey: 'fhirId',
      placeholder: facilityOptions.length
        ? 'Select receiving facility...'
        : orgsRes.ok
          ? 'No facilities returned from FHIR'
          : 'Could not load facilities from FHIR',
      labelFn: (o) =>
        `${o.name || '-'}${o.nhfrCode && o.nhfrCode !== '-' ? ` (${o.nhfrCode})` : ''}${
          o.id ? '' : ' · FHIR'
        }`,
    });

    // Practitioner roles load only after a facility is chosen (scoped by organization).
    await Promise.all([
      loadReferralPractitionerRolesForFacility('sending'),
      loadReferralPractitionerRolesForFacility('receiving'),
    ]);

    const categoryOptions = (categoriesData.results || []).filter((c) => c.code);
    fillSelect(categorySelect, categoryOptions, {
      valueKey: 'code',
      preferredValue: '73770003',
      placeholder: categoryOptions.length
        ? 'Select referral priority...'
        : categoriesRes.ok
          ? 'No referral priorities returned'
          : 'Could not load referral priorities',
      labelFn: (c) => c.display || c.text || c.code,
    });
    if (!categoriesRes.ok && !quiet) {
      showToast(categoriesData.error || 'Could not load referral priorities from terminology', 'warn', {
        title: 'Referral Priority',
      });
    }

    if (!wasSeeded || !$('#referralDateLocal').value) {
      $('#referralDateLocal').value = toLocalDateTimeValue();
    }
    form.dataset.seeded = '1';

    updateReferralFormAlert({
      patients: patients.length,
      facilities: facilityOptions.length,
    });
  } catch (err) {
    state.referralLookups.patientsLoading = false;
    state.referralLookups.patientsLoaded = true;
    if (!quiet) showToast(err.message, 'err', { title: 'Could not load referral form' });
  }
}

function updateReferralFormAlert({ patients, facilities } = {}) {
  const missing = [];
  if (!patients) missing.push('FHIR patients');
  if (facilities < 2) missing.push('at least two FHIR facilities');
  if (!missing.length) return;

  showToast(`Waiting on ${missing.join(', ')}.`, 'warn', {
    title: 'Referral form',
  });
}

function practitionerRoleLabel(role, organizations = []) {
  const name =
    role.practitionerName ||
    `${role.prefix ? `${role.prefix} ` : ''}${role.givenName || ''} ${role.familyName || ''}`.trim() ||
    (role.practitionerFhirId ? `Practitioner ${role.practitionerFhirId}` : 'Practitioner');
  const roleText = role.roleDisplay || role.roleCode || 'Role';
  const org = organizations.find((o) => String(o.fhirId) === String(role.organizationFhirId));
  const orgName = org?.name || (role.organizationFhirId ? `Org ${role.organizationFhirId}` : '');
  const prc = role.prcId && role.prcId !== '-' ? role.prcId : '';
  return [name, roleText, prc ? `PRC ${prc}` : null, orgName || null].filter(Boolean).join(' · ');
}

function fillReferralPractitionerRoles() {
  loadReferralPractitionerRolesForFacility('sending');
  loadReferralPractitionerRolesForFacility('receiving');
}

const referralRoleFetchSeq = { sending: 0, receiving: 0 };

function mergeReferralRoleCache(roles) {
  const existing = state.referralLookups.practitionerRoles || [];
  const byId = new Map(existing.map((r) => [String(r.fhirId), r]));
  for (const role of roles || []) {
    if (!role?.fhirId) continue;
    byId.set(String(role.fhirId), role);
  }
  const merged = [...byId.values()];
  state.referralLookups.practitionerRoles = merged;
  state.referralLookups.practitioners = merged;
}

async function loadReferralPractitionerRolesForFacility(which) {
  const orgSelect =
    which === 'sending' ? $('#referralSendingOrgId') : $('#referralReceivingOrgId');
  const pracSelect =
    which === 'sending' ? $('#referralSendingPracId') : $('#referralReceivingPracId');
  if (!pracSelect) return;

  const orgFhirId = String(orgSelect?.value || '').trim();
  const organizations = state.referralLookups.organizations || [];
  const sideLabel = which === 'sending' ? 'sending' : 'receiving';
  const seq = ++referralRoleFetchSeq[which];

  if (!orgFhirId) {
    fillSelect(pracSelect, [], {
      valueKey: 'fhirId',
      placeholder: 'Select facility first...',
      labelFn: (r) => practitionerRoleLabel(r, organizations),
    });
    return;
  }

  destroySearchableSelect(pracSelect);
  pracSelect.innerHTML = `<option value="">Loading ${sideLabel} practitioner roles...</option>`;
  initSearchableSelect(pracSelect, { force: true });

  try {
    const res = await fetch(
      `/api/practitioners/roles?organization=${encodeURIComponent(orgFhirId)}&count=200`
    );
    const data = await parseResponseJson(res, '/api/practitioners/roles');
    if (seq !== referralRoleFetchSeq[which]) return;
    if (!res.ok) throw new Error(data.error || `Could not load ${sideLabel} practitioner roles`);

    const roles = (data.roles || []).filter((r) => r.fhirId);
    mergeReferralRoleCache(roles);
    fillSelect(pracSelect, roles, {
      valueKey: 'fhirId',
      placeholder: roles.length
        ? `Select ${sideLabel} practitioner role...`
        : 'No practitioner roles for this facility',
      labelFn: (r) => practitionerRoleLabel(r, organizations),
    });
  } catch (err) {
    if (seq !== referralRoleFetchSeq[which]) return;
    fillSelect(pracSelect, [], {
      valueKey: 'fhirId',
      placeholder: 'Could not load roles for this facility',
      labelFn: (r) => practitionerRoleLabel(r, organizations),
    });
    showToast(err.message, 'err', { title: 'Practitioner roles' });
  }
}

function onReferralFacilityChanged(e) {
  const id = e?.target?.id || e?.currentTarget?.id || '';
  if (id === 'referralSendingOrgId') {
    loadReferralPractitionerRolesForFacility('sending');
    return;
  }
  if (id === 'referralReceivingOrgId') {
    loadReferralPractitionerRolesForFacility('receiving');
    return;
  }
  fillReferralPractitionerRoles();
}
function destroyDiagnosisSelect(el) {
  const $el = window.jQuery?.(el);
  if ($el?.length && $el.data('select2')) {
    $el.off('.diagnosisSelect');
    $el.select2('destroy');
  }
}

function diagnosisOptionHtml(item, { selected = false } = {}) {
  if (!item?.id) return item?.text || '';
  const title = escapeHtml(item.display || item.text || item.id);
  const snomed = escapeHtml(item.snomedCode || item.code || item.id || '-');
  if (selected) {
    return `<span class="dx-selected">${title}</span>`;
  }
  return `
    <span class="dx-option">
      <span class="dx-option-title">${title}</span>
      <span class="dx-option-meta">
        <span class="dx-chip">SNOMED CT</span>
        <span class="dx-chip dx-chip-code">${snomed}</span>
        <span class="dx-chip dx-chip-muted">Clinical finding</span>
      </span>
    </span>
  `;
}

function roleSpecialtyOptionHtml(item, { selected = false } = {}) {
  if (!item?.id) return item?.text || '';
  const title = escapeHtml(item.display || item.text || item.id);
  const code = escapeHtml(item.code || item.id || '-');
  const kind = item.suggested ? 'DOH role' : 'DOH role';
  if (selected) {
    return `<span class="dx-selected">${title}</span>`;
  }
  return `
    <span class="dx-option">
      <span class="dx-option-title">${title}</span>
      <span class="dx-option-meta">
        <span class="dx-chip">${kind}</span>
        <span class="dx-chip dx-chip-code">${code}</span>
        <span class="dx-chip dx-chip-muted">Allowed by CDR</span>
      </span>
    </span>
  `;
}

function destroyRoleSpecialtySelect(el) {
  const $el = window.jQuery?.(el);
  if ($el?.length && $el.data('select2')) {
    $el.off('.roleSpecialtySelect');
    $el.select2('destroy');
  }
}

function initRoleSpecialtySelect(select, { force = false } = {}) {
  const $el = window.jQuery?.(select);
  if (!$el?.length || !jQuery.fn.select2) return;

  if ($el.data('select2')) {
    if (!force) return;
    destroyRoleSpecialtySelect(select);
  }

  if (![...select.options].some((o) => o.value === '')) {
    select.insertAdjacentHTML('afterbegin', '<option value=""></option>');
  }

  $el.select2({
    width: '100%',
    placeholder:
      $el.data('placeholder') || 'Pick a DOH role, or type to filter...',
    allowClear: !select.required,
    minimumInputLength: 0,
    dropdownParent: jQuery('body'),
    language: {
      searching: () => 'Loading DOH practitioner roles...',
      noResults: () => 'No matching DOH practitioner role. Try Doctor, Nurse, Midwife...',
      errorLoading: () => 'Could not load practitioner roles',
    },
    templateResult(item) {
      if (item.loading) return item.text;
      if (item.children) {
        return jQuery(
          `<span class="dx-option-title">${escapeHtml(item.text || '')}</span>`
        );
      }
      return jQuery(roleSpecialtyOptionHtml(item));
    },
    templateSelection(item) {
      if (!item?.id) return item?.text || '';
      return jQuery(roleSpecialtyOptionHtml(item, { selected: true }));
    },
    escapeMarkup(markup) {
      return markup;
    },
    ajax: {
      delay: 200,
      data(params) {
        return { q: params.term || '', count: 25 };
      },
      transport(params, success, failure) {
        const term = String(params.data?.q || params.data?.term || '').trim();
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const url = term
          ? `/api/psgc/practitioner-roles?q=${encodeURIComponent(term)}&count=25`
          : `/api/psgc/practitioner-roles?count=25`;
        fetch(url, { signal: controller?.signal })
          .then(async (res) => {
            const data = await parseResponseJson(res, '/api/psgc/practitioner-roles');
            if (!res.ok || data?.error) {
              throw new Error(data?.error || `Role search failed (${res.status})`);
            }
            success({ ...data, _term: term });
          })
          .catch((err) => {
            if (err?.name === 'AbortError') return;
            failure(err);
          });
        return {
          abort() {
            controller?.abort();
          },
        };
      },
      processResults(data) {
        const results = (data.resultsSelect2 || data.results || []).map((r) => ({
          id: r.id || `${r.code}|${r.display}`,
          text: r.display || r.text || r.code,
          code: r.code,
          display: r.display || r.text || '',
          system: r.system || DEFAULT_ROLE_SYSTEM,
          suggested: Boolean(r.suggested) || data.source === 'fallback',
        }));
        state.practitionerRoles.lookups.roleCodes = [
          ...(state.practitionerRoles.lookups.roleCodes || []).filter(
            (existing) => !results.some((r) => String(r.code) === String(existing.code))
          ),
          ...results,
        ];

        const term = String(data._term || '').trim();
        if (!term) {
          return {
            results: [
              {
                text: 'DOH Practitioner Role VS (required by FHIR server)',
                children: results,
              },
            ],
          };
        }
        return {
          results: [
            {
              text: 'Matching DOH roles',
              children: results,
            },
          ],
        };
      },
    },
  });

  $el.off('.roleSpecialtySelect');
  $el.on('select2:select.roleSpecialtySelect', (e) => {
    const item = e.params?.data || {};
    const form = select.closest('form');
    if (!form) return;
    const code = item.code || String(item.id || '').split('|')[0] || '';
    const display = item.display || item.text || code;
    const system = item.system || DEFAULT_ROLE_SYSTEM;
    if (form.roleCode) form.roleCode.value = code;
    if (form.roleDisplay) form.roleDisplay.value = display;
    if (form.roleSystem) form.roleSystem.value = system;
    select.value = item.id || `${code}|${display}`;
  });

  $el.on('select2:clear.roleSpecialtySelect', () => {
    const form = select.closest('form');
    if (!form) return;
    if (form.roleCode) form.roleCode.value = '';
    if (form.roleDisplay) form.roleDisplay.value = '';
    if (form.roleSystem) form.roleSystem.value = DEFAULT_ROLE_SYSTEM;
  });
}

function initWorkingImpressionSelect({ force = false } = {}) {
  const select = $('#referralWorkingImpressionDx');
  const $el = window.jQuery?.(select);
  if (!$el?.length) return;

  if ($el.data('select2')) {
    if (!force) return;
    destroyDiagnosisSelect(select);
  }

  if (![...select.options].some((o) => o.value === '')) {
    select.insertAdjacentHTML('afterbegin', '<option value=""></option>');
  }
  select.value = '';

  $el.select2({
    width: '100%',
    placeholder: $el.data('placeholder') || 'Type a diagnosis, e.g. headache or pre-eclampsia...',
    allowClear: true,
    minimumInputLength: 2,
    dropdownParent: jQuery('body'),
    language: {
      inputTooShort: () => 'Type at least 2 letters to search diagnoses',
      searching: () => 'Searching diagnoses...',
      noResults: () => 'No diagnoses found',
      errorLoading: () => 'Could not load diagnoses',
    },
    templateResult(item) {
      if (item.loading) return item.text;
      return jQuery(diagnosisOptionHtml(item));
    },
    templateSelection(item) {
      if (!item?.id) return item?.text || '';
      return jQuery(diagnosisOptionHtml(item, { selected: true }));
    },
    escapeMarkup(markup) {
      return markup;
    },
    ajax: {
      delay: 280,
      data(params) {
        return { q: params.term || '', count: 25 };
      },
      transport(params, success, failure) {
        const term = String(params.data?.q || params.data?.term || '').trim();
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        fetch(`/api/psgc/diagnoses?q=${encodeURIComponent(term)}&count=25`, {
          signal: controller?.signal,
        })
          .then(async (res) => {
            const data = await parseResponseJson(res, '/api/psgc/diagnoses');
            if (!res.ok || data?.error) {
              throw new Error(data?.error || `Diagnosis search failed (${res.status})`);
            }
            success(data);
          })
          .catch((err) => {
            if (err?.name === 'AbortError') return;
            failure(err);
          });
        return {
          abort() {
            controller?.abort();
          },
        };
      },
      processResults(data) {
        return {
          results: (data.resultsSelect2 || data.results || []).map((r) => ({
            id: r.id || r.code,
            text: r.display || r.text || r.code,
            code: r.code || r.id,
            display: r.display || r.text || '',
            system: r.system,
            snomedCode: r.snomedCode || r.code || r.id,
            icdCode: r.icdCode || null,
            icdDisplay: r.icdDisplay || null,
          })),
        };
      },
    },
  });

  $el.off('.diagnosisSelect');
  $el.on('select2:select.diagnosisSelect', (e) => {
    const item = e.params?.data || {};
    const code = item.code || item.snomedCode || item.id || '';
    const display = item.display || item.text || code;
    if ($('#referralWorkingImpressionCode')) $('#referralWorkingImpressionCode').value = code;
    if ($('#referralWorkingImpressionDisplay')) {
      $('#referralWorkingImpressionDisplay').value = display;
    }
    if ($('#referralWorkingImpressionText')) {
      $('#referralWorkingImpressionText').value = display || code;
    }
  });

  $el.on('select2:clear.diagnosisSelect', () => {
    if ($('#referralWorkingImpressionCode')) $('#referralWorkingImpressionCode').value = '';
    if ($('#referralWorkingImpressionDisplay')) $('#referralWorkingImpressionDisplay').value = '';
    if ($('#referralWorkingImpressionText')) $('#referralWorkingImpressionText').value = '';
  });
}

function resetWorkingImpressionSelect() {
  const select = $('#referralWorkingImpressionDx');
  const $el = window.jQuery?.(select);
  if ($el?.length && $el.data('select2')) {
    $el.val(null).trigger('change');
  } else if (select) {
    select.value = '';
  }
  if ($('#referralWorkingImpressionCode')) $('#referralWorkingImpressionCode').value = '';
  if ($('#referralWorkingImpressionDisplay')) $('#referralWorkingImpressionDisplay').value = '';
  if ($('#referralWorkingImpressionText')) $('#referralWorkingImpressionText').value = '';
}

function sentReferralActionButtons(r) {
  if (!r.id) return '<span class="muted">-</span>';
  return actionMenu(
    actionMenuItem('View', `data-action="view" data-entity="sent-referral" data-id="${r.id}"`)
  );
}

function patientDisplayName(p) {
  return `${p?.givenName1 || ''} ${p?.givenName2 || ''} ${p?.familyName || ''}`
    .replace(/\s+/g, ' ')
    .trim() || '-';
}

function patientAgeFromBirthDate(birthDate) {
  if (!birthDate) return '-';
  const d = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '-';
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? String(age) : '-';
}

function patientAddressLine(p) {
  return [
    p.addressLine,
    p.barangayDisplay,
    p.cityDisplay,
    p.provinceDisplay,
    p.regionDisplay,
    p.postalCode,
  ]
    .filter((part) => part && String(part).trim() && String(part).trim() !== '-')
    .join(', ');
}

function formatPatientBirthDisplay(birthDate) {
  if (!birthDate) return '-';
  const d = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return birthDate;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function clearReferralPatientPicker() {
  const input = $('#referralPatientId');
  if (input) input.value = '';
  const fhirInput = $('#referralPatientFhirId');
  if (fhirInput) fhirInput.value = '';
  const selected = $('#referralPatientSelected');
  const trigger = $('#referralPatientPickBtn');
  if (selected) selected.hidden = true;
  if (trigger) trigger.hidden = false;
  if ($('#referralPatientName')) $('#referralPatientName').textContent = '-';
  if ($('#referralPatientBadges')) $('#referralPatientBadges').innerHTML = '';
  if ($('#referralPatientAddress')) {
    $('#referralPatientAddress').textContent = '';
    $('#referralPatientAddress').hidden = true;
  }
  [
    ['#referralPatientSex', '-'],
    ['#referralPatientAge', '-'],
    ['#referralPatientBirth', '-'],
    ['#referralPatientPhilsys', '-'],
    ['#referralPatientPhilhealth', '-'],
    ['#referralPatientFhir', '-'],
  ].forEach(([sel, value]) => {
    if ($(sel)) $(sel).textContent = value;
  });
}

function patientPickerKey(patient) {
  if (patient?.fhirId) return `fhir:${patient.fhirId}`;
  if (patient?.id) return `local:${patient.id}`;
  return '';
}

function setReferralPatient(patient) {
  if (!patient?.fhirId && !patient?.id) {
    clearReferralPatientPicker();
    return;
  }
  const input = $('#referralPatientId');
  if (input) input.value = patient.id != null ? String(patient.id) : '';
  const fhirInput = $('#referralPatientFhirId');
  if (fhirInput) fhirInput.value = patient.fhirId ? String(patient.fhirId) : '';

  if ($('#referralPatientName')) $('#referralPatientName').textContent = patientDisplayName(patient);

  const badges = [];
  if (patient.fhirId) {
    badges.push(`<span class="patient-chip patient-chip-ok">FHIR patient</span>`);
  }
  if (patient.id) {
    badges.push(`<span class="patient-chip patient-chip-muted">Local cache</span>`);
  }
  if (patient.philsysId) {
    badges.push(`<span class="patient-chip">PhilSys on file</span>`);
  }
  if ($('#referralPatientBadges')) $('#referralPatientBadges').innerHTML = badges.join('');

  const address = patientAddressLine(patient);
  const addressEl = $('#referralPatientAddress');
  if (addressEl) {
    if (address) {
      addressEl.hidden = false;
      addressEl.textContent = address;
    } else {
      addressEl.hidden = true;
      addressEl.textContent = '';
    }
  }

  if ($('#referralPatientSex')) {
    $('#referralPatientSex').textContent = patient.gender || '-';
  }
  if ($('#referralPatientAge')) {
    $('#referralPatientAge').textContent = patientAgeFromBirthDate(patient.birthDate);
  }
  if ($('#referralPatientBirth')) {
    $('#referralPatientBirth').textContent = formatPatientBirthDisplay(patient.birthDate);
  }
  if ($('#referralPatientPhilsys')) {
    $('#referralPatientPhilsys').textContent = patient.philsysId || '-';
    $('#referralPatientPhilsys').title = patient.philsysId || '';
  }
  if ($('#referralPatientPhilhealth')) {
    $('#referralPatientPhilhealth').textContent = patient.philhealthId || '-';
    $('#referralPatientPhilhealth').title = patient.philhealthId || '';
  }
  if ($('#referralPatientFhir')) {
    $('#referralPatientFhir').textContent = patient.fhirId || '-';
    $('#referralPatientFhir').title = patient.fhirId || '';
  }

  const selected = $('#referralPatientSelected');
  const trigger = $('#referralPatientPickBtn');
  if (selected) selected.hidden = false;
  if (trigger) trigger.hidden = true;
}

function filterReferralPatients(q = '') {
  const query = String(q || '').trim().toLowerCase();
  const patients = state.referralLookups.patients || [];
  if (!query) return patients;
  return patients.filter((p) => {
    const hay = [
      p.givenName1,
      p.givenName2,
      p.familyName,
      p.philsysId,
      p.philhealthId,
      p.fhirId,
      p.birthDate,
      p.localCode,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(query);
  });
}

function renderPatientPickerRows(patients, { loading = false } = {}) {
  const body = $('#patientPickerBody');
  const selectBtn = $('#patientPickerSelectBtn');
  if (!body) return;
  if (selectBtn) selectBtn.disabled = true;

  if (loading || state.referralLookups.patientsLoading) {
    body.innerHTML = `<tr><td colspan="6" class="placeholder">Loading patients...</td></tr>`;
    return;
  }

  if (!patients.length) {
    body.innerHTML = `<tr><td colspan="6" class="placeholder">${
      ($('#patientPickerSearch')?.value || '').trim()
        ? 'No patients match your search'
        : 'No FHIR patients found'
    }</td></tr>`;
    return;
  }

  body.innerHTML = patients
    .map((p) => {
      const name = patientDisplayName(p);
      const key = patientPickerKey(p);
      return `<tr class="patient-picker-row" data-patient-key="${escapeHtml(key)}">
        <td class="col-check">
          <input type="radio" name="patientPickerChoice" value="${escapeHtml(key)}" aria-label="Select ${escapeHtml(name)}" />
        </td>
        <td><span class="cell-ellipsis" title="${escapeHtml(name)}">${escapeHtml(name)}</span></td>
        <td><span class="cell-ellipsis" title="${escapeHtml(p.birthDate || '-')}">${escapeHtml(p.birthDate || '-')}</span></td>
        <td><span class="cell-ellipsis" title="${escapeHtml(p.philsysId || '-')}">${escapeHtml(p.philsysId || '-')}</span></td>
        <td><span class="cell-ellipsis" title="${escapeHtml(p.philhealthId || '-')}">${escapeHtml(p.philhealthId || '-')}</span></td>
        <td><span class="cell-ellipsis" title="${escapeHtml(p.fhirId || '-')}">${escapeHtml(p.fhirId || '-')}</span></td>
      </tr>`;
    })
    .join('');
}

function closePatientPickerModal() {
  const modal = $('#patientPickerModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
}

async function ensureReferralPatientsLoaded() {
  if (state.referralLookups.patientsLoaded && !state.referralLookups.patientsLoading) {
    return state.referralLookups.patients || [];
  }
  if (state.referralLookups.patientsLoading) {
    // Wait briefly for in-flight prepareReferralForm fetch.
    for (let i = 0; i < 40 && state.referralLookups.patientsLoading; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (state.referralLookups.patientsLoaded) {
      return state.referralLookups.patients || [];
    }
  }

  state.referralLookups.patientsLoading = true;
  renderPatientPickerRows([], { loading: true });
  try {
    const res = await fetch('/api/patients?source=fhir&count=200');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not load patients');
    const patients = (data.patients || []).filter((p) => p.fhirId || p.id);
    state.referralLookups.patients = patients;
    state.referralLookups.patientsLoaded = true;
    return patients;
  } catch (err) {
    state.referralLookups.patients = [];
    state.referralLookups.patientsLoaded = true;
    showToast(err.message || 'Could not load patients', 'err', { title: 'Patients' });
    return [];
  } finally {
    state.referralLookups.patientsLoading = false;
  }
}

async function openPatientPickerModal() {
  const modal = $('#patientPickerModal');
  if (!modal) return;
  const search = $('#patientPickerSearch');
  if (search) search.value = '';
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  renderPatientPickerRows([], { loading: true });
  search?.focus();
  await ensureReferralPatientsLoaded();
  if (modal.hidden) return;
  renderPatientPickerRows(filterReferralPatients(search?.value || ''));
}

function confirmPatientPickerSelection() {
  const chosen = document.querySelector('input[name="patientPickerChoice"]:checked');
  if (!chosen) {
    showToast('Select a patient from the list.', 'err', { title: 'Patient' });
    return;
  }
  const patient = (state.referralLookups.patients || []).find(
    (p) => patientPickerKey(p) === String(chosen.value)
  );
  if (!patient) {
    showToast('Selected patient was not found.', 'err', { title: 'Patient' });
    return;
  }
  setReferralPatient(patient);
  closePatientPickerModal();
}

function closeReferralSyncModal() {
  const modal = $('#referralSyncModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  const retryBtn = $('#referralSyncRetryBtn');
  if (retryBtn) {
    retryBtn.hidden = true;
    delete retryBtn.dataset.referralId;
  }
}

function openReferralSyncModal(referral) {
  const modal = $('#referralSyncModal');
  if (!modal || !referral) return;

  const syncStatus = referral.syncStatus || 'pending';
  const canRetry = ['failed', 'pending'].includes(String(syncStatus).toLowerCase());
  const taskFhirId = referral.taskFhirId || null;
  state.activeReferralView = {
    taskFhirId,
    localId: referral.id || null,
  };

  $('#referralSyncTitle').textContent = referral.localCode || 'Sent referral';
  $('#referralSyncSubtitle').textContent = referral.patientName
    ? `Patient: ${referral.patientName}`
    : 'Outbound referral sync details';

  const syncClass = syncChipClass(syncStatus);
  $('#referralSyncChips').innerHTML = [
    `<span class="modal-meta-item ${syncClass}"><span class="dot"></span>${escapeHtml(
      displayValue(syncStatus)
    )}</span>`,
    referral.taskStatus
      ? `<span class="modal-meta-sep" aria-hidden="true"></span><span class="modal-meta-item muted">Task ${escapeHtml(
          referral.taskStatus
        )}</span>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const errorSection = referral.syncError
    ? detailSection(
        'FHIR sync error',
        `<div class="detail-item full"><dt>Details</dt><dd><pre class="sync-error-box">${escapeHtml(
          referral.syncError
        )}</pre></dd></div>`
      )
    : detailSection(
        'FHIR sync error',
        detailItem('Details', 'No sync error stored for this referral.', { full: true })
      );

  $('#referralSyncBody').innerHTML = [
    taskFhirId ? referralPackageActionsHtml(taskFhirId) : '',
    detailSection(
      'Referral',
      [
        detailItem('Local code', referral.localCode),
        detailItem('Patient', referral.patientName),
        detailItem('Receiving facility', referral.receivingOrgName),
        detailItem('Category', referral.categoryText || referral.categoryDisplay),
        detailItem('When', formatTime(referral.dateOfReferral || referral.createdAt)),
        detailItem('ServiceRequest', referral.serviceRequestFhirId),
        detailItem('Task', referral.taskFhirId),
      ].join('')
    ),
    errorSection,
  ].join('');

  const retryBtn = $('#referralSyncRetryBtn');
  if (retryBtn) {
    retryBtn.hidden = !canRetry;
    retryBtn.dataset.referralId = String(referral.id || '');
  }

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  if (taskFhirId) {
    loadReferralTaskHistory(taskFhirId, {
      root: modal,
      quiet: true,
    });
  }
}

async function openSentReferral(id) {
  try {
    const cached = (state.referrals.items || []).find((r) => String(r.id) === String(id));
    if (cached) {
      openReferralSyncModal(cached);
      return;
    }
    const res = await fetch(`/api/referrals/${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not load referral');
    openReferralSyncModal(data);
  } catch (err) {
    showToast(err.message, 'err', { title: 'Sent referral' });
  }
}

async function retryReferralSync(referralId, triggerEl) {
  if (!referralId) return;
  if (triggerEl) triggerEl.disabled = true;
  try {
    await withProgress(
      {
        title: 'Retrying referral sync',
        message: 'Rebuilding the referral Bundle and posting to FHIR.',
        steps: ['Load local referral', 'Sync parties', 'Submit Bundle'],
      },
      async ({ setProgressStep, completeProgressModal }) => {
        setProgressStep(0, 'done');
        setProgressStep(1, 'active');
        const res = await fetch(`/api/referrals/${encodeURIComponent(referralId)}/sync`, {
          method: 'POST',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Referral sync failed');
        setProgressStep(1, 'done');
        setProgressStep(2, 'done');
        completeProgressModal(true);
        const sr = data.fhir?.serviceRequestId || data.referral?.serviceRequestFhirId || '-';
        showToast(`Referral synced (ServiceRequest ${sr})`, 'ok', { title: 'Retry complete' });
        closeReferralSyncModal();
        loadSentReferrals();
        loadDashboard();
      }
    );
  } catch (err) {
    showToast(err.message, 'err', { title: 'Retry failed' });
    loadSentReferrals();
    // Refresh modal with latest error if still open.
    try {
      const res = await fetch(`/api/referrals/${encodeURIComponent(referralId)}`);
      const data = await res.json().catch(() => null);
      if (res.ok && data && !$('#referralSyncModal')?.hidden) {
        openReferralSyncModal(data);
      }
    } catch {
      // ignore refresh errors
    }
  } finally {
    if (triggerEl) triggerEl.disabled = false;
  }
}

async function loadSentReferrals({ q } = {}) {
  const body = $('#sentBody');
  const meta = $('#sentMeta');
  if (!body) return;

  if (q !== undefined) state.referrals.q = q;
  const query = state.referrals.q || $('#sentSearch')?.value?.trim() || '';
  state.referrals.q = query;
  if ($('#sentSearch')) $('#sentSearch').value = query;

  body.innerHTML = `<tr><td colspan="8" class="placeholder">Loading...</td></tr>`;
  try {
    const params = new URLSearchParams({ direction: 'sent' });
    if (query) params.set('q', query);
    const res = await fetch(`/api/referrals?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load referrals');

    const referrals = data.referrals || [];
    state.referrals.total = referrals.length;
    state.referrals.items = referrals;
    if (meta) meta.textContent = `${referrals.length} sent referral(s)`;

    if (!referrals.length) {
      body.innerHTML = `<tr><td colspan="8" class="placeholder">No sent referrals yet.</td></tr>`;
      return;
    }

    body.innerHTML = referrals
      .map(
        (r) => `
      <tr>
        <td><code>${escapeHtml(r.localCode || '-')}</code></td>
        <td>${escapeHtml(r.patientName || '-')}</td>
        <td>${escapeHtml(r.receivingOrgName || '-')}</td>
        <td>${escapeHtml(r.categoryText || r.categoryDisplay || '-')}</td>
        <td>${statusTag(r.taskStatus)}</td>
        <td>${statusTag(r.syncStatus)}${
          r.serviceRequestFhirId
            ? `<div class="muted" style="margin-top:0.25rem;font-size:0.78rem;">SR ${escapeHtml(
                r.serviceRequestFhirId
              )}</div>`
            : ''
        }</td>
        <td>${formatTime(r.dateOfReferral || r.createdAt)}</td>
        <td>${sentReferralActionButtons(r)}</td>
      </tr>`
      )
      .join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="8" class="placeholder">${escapeHtml(err.message)}</td></tr>`;
    if (meta) meta.textContent = 'Error';
    showToast(err.message, 'err', { title: 'Sent referrals' });
  }
}

function openInboxActions(status) {
  const open = ['requested', 'received', 'in-progress', 'on-hold'].includes(
    String(status || '').toLowerCase()
  );
  return open;
}

function incomingActionButtons(r) {
  const canAct =
    openInboxActions(r.taskStatus) && (r.id || r.taskFhirId || r.serviceRequestFhirId);
  const viewAttr = r.id
    ? `data-action="view" data-entity="incoming" data-id="${r.id}"`
    : r.taskFhirId
      ? `data-action="view" data-entity="incoming-task" data-task-id="${escapeHtml(r.taskFhirId)}"`
      : r.serviceRequestFhirId
        ? `data-action="view" data-entity="incoming-sr" data-sr-id="${escapeHtml(
            r.serviceRequestFhirId
          )}"`
        : '';
  const statusAttr = r.id
    ? `data-id="${r.id}"`
    : r.taskFhirId
      ? `data-task-id="${escapeHtml(r.taskFhirId)}"`
      : r.serviceRequestFhirId
        ? `data-sr-id="${escapeHtml(r.serviceRequestFhirId)}"`
        : '';
  const transferAttr = r.taskFhirId
    ? `data-action="transfer" data-entity="incoming-task" data-task-id="${escapeHtml(
        r.taskFhirId
      )}" data-patient-name="${escapeHtml(r.patientName || '')}" data-receiving-org-id="${escapeHtml(
        r.receivingOrgFhirId || ''
      )}" data-receiving-org-name="${escapeHtml(r.receivingOrgName || '')}"`
    : '';
  const items = [
    viewAttr ? actionMenuItem('View', viewAttr) : '',
    canAct ? actionMenuItem('Accept', `data-incoming-status="accepted" ${statusAttr}`) : '',
    canAct ? actionMenuItem('Reject', `data-incoming-status="rejected" ${statusAttr}`) : '',
    canAct && transferAttr ? actionMenuItem('Transfer', transferAttr) : '',
  ]
    .filter(Boolean)
    .join('');
  return actionMenu(items);
}

async function ensureInboxFacilityFilter() {
  const select = $('#inboxReceivingFacilityFilter');
  if (!select || state.inbox.facilitiesLoaded) return;

  const previous = state.inbox.receivingOrgFhirId || select.value || '';
  destroySearchableSelect(select);
  select.innerHTML = `<option value="">Loading facilities...</option>`;
  select.disabled = true;
  initSearchableSelect(select, { force: true });

  try {
    const res = await fetch('/api/organizations?source=fhir&count=200');
    const data = await res.json().catch(() => ({ organizations: [] }));
    if (!res.ok) throw new Error(data.error || 'Could not load facilities from FHIR');

    const byFhirId = new Map();
    (data.organizations || []).forEach((o) => {
      if (!o?.fhirId) return;
      const prev = byFhirId.get(o.fhirId) || {};
      byFhirId.set(o.fhirId, {
        ...prev,
        ...o,
        fhirId: o.fhirId,
        name: o.name || prev.name || o.fhirId,
        nhfrCode: o.nhfrCode || prev.nhfrCode || null,
      });
    });

    const facilities = [...byFhirId.values()].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''))
    );

    destroySearchableSelect(select);
    select.innerHTML = `<option value="">All facilities</option>`;
    facilities.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.fhirId;
      const full =
        `${o.name || o.fhirId}` +
        (o.nhfrCode && o.nhfrCode !== '-' ? ` (${o.nhfrCode})` : '');
      opt.title = full;
      opt.textContent = shortFacilityLabel(full, 42);
      select.appendChild(opt);
    });
    state.inbox.facilitiesLoaded = true;
    // Default to All facilities so inbox is never empty due to home-only filter.
    const preferred =
      state.inbox.receivingOrgFhirId != null && state.inbox.receivingOrgFhirId !== ''
        ? String(state.inbox.receivingOrgFhirId)
        : previous || '';
    state.inbox.suppressFacilityChange = true;
    if (preferred && [...select.options].some((o) => o.value === preferred)) {
      select.value = preferred;
      state.inbox.receivingOrgFhirId = preferred;
    } else {
      select.value = '';
      state.inbox.receivingOrgFhirId = '';
    }
    initSearchableSelect(select, { force: true });
    setTimeout(() => {
      state.inbox.suppressFacilityChange = false;
    }, 0);
  } catch (err) {
    destroySearchableSelect(select);
    select.innerHTML = `<option value="">All facilities</option>`;
    initSearchableSelect(select, { force: true });
    showToast(err.message || 'Could not load facilities', 'warn', {
      title: 'Facility filter',
    });
  } finally {
    select.disabled = false;
    jQuery(select).prop('disabled', false).trigger('change.select2');
  }
}

function stopInboxAutoRefresh() {
  if (state.inbox.pollTimer) {
    clearInterval(state.inbox.pollTimer);
    state.inbox.pollTimer = null;
  }
}

function startInboxAutoRefresh() {
  stopInboxAutoRefresh();
  state.inbox.pollTimer = setInterval(() => {
    if (currentViewId() !== 'inbox') return;
    if (document.hidden) return;
    if (state.inbox.loading) return;
    loadInboxReferrals({ force: true, quiet: true, page: state.inbox.page || 1 });
  }, 15000);
}

function shortFacilityLabel(name, max = 36) {
  const text = String(name || '').trim();
  if (!text) return '-';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function updateInboxPager() {
  const { page, totalPages, total, pageSize, q, cache } = state.inbox;
  const label = $('#inboxPageLabel');
  const prev = $('#inboxPrev');
  const next = $('#inboxNext');
  const meta = $('#inboxMeta');
  if (label) label.textContent = `Page ${page} of ${totalPages}`;
  if (prev) prev.disabled = page <= 1;
  if (next) next.disabled = page >= totalPages;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  if (meta) {
    const facilityFilter = state.inbox.receivingOrgFhirId || '';
    const cached = Array.isArray(cache) && cache.length;
    meta.textContent = [
      q
        ? `${from}-${to} of ${total} match${total === 1 ? '' : 'es'}`
        : `${from}-${to} of ${total}`,
      facilityFilter ? 'filtered by facility (from or to)' : null,
      cached ? `${cache.length} from FHIR` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }
}

function filterInboxCache(items, { q, status, receivingOrgFhirId } = {}) {
  let rows = Array.isArray(items) ? [...items] : [];

  if (status && status !== 'all') {
    const wanted = String(status).toLowerCase();
    rows = rows.filter((r) => String(r.taskStatus || '').toLowerCase() === wanted);
  }

  if (receivingOrgFhirId) {
    const facilityId = String(receivingOrgFhirId).trim();
    rows = rows.filter((r) => {
      const recv = String(r.receivingOrgFhirId || '');
      const send = String(r.sendingOrgFhirId || '');
      return recv === facilityId || send === facilityId;
    });
  }

  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((r) =>
      [
        r.localCode,
        r.requisitionValue,
        r.patientName,
        r.sendingOrgName,
        r.receivingOrgName,
        r.sendingPracName,
        r.receivingPracName,
        r.serviceRequestFhirId,
        r.taskFhirId,
        r.taskStatus,
        r.reasonText,
        r.categoryText,
        r.categoryDisplay,
        r.chiefComplaint,
        r.workingImpression,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }

  return rows;
}

function renderInboxFromCache() {
  const body = $('#inboxBody');
  if (!body) return;

  const query = state.inbox.q || '';
  const statusFilter = state.inbox.status || 'all';
  const facilityFilter = state.inbox.receivingOrgFhirId || '';
  const filtered = filterInboxCache(state.inbox.cache, {
    q: query,
    status: statusFilter,
    receivingOrgFhirId: facilityFilter,
  });

  const pageSize = state.inbox.pageSize;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, state.inbox.page || 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  const referrals = filtered.slice(start, start + pageSize);

  state.inbox.page = currentPage;
  state.inbox.totalPages = totalPages;
  state.inbox.total = total;
  updateInboxPager();

  const openCount = filterInboxCache(state.inbox.cache, {
    status: 'all',
    receivingOrgFhirId: facilityFilter,
  }).filter((r) =>
    ['requested', 'received', 'in-progress', 'on-hold'].includes(
      String(r.taskStatus || '').toLowerCase()
    )
  ).length;
  setInboxBadgeCount(openCount || total || 0);

  if (!total) {
    let emptyMsg = 'No incoming referrals found on FHIR.';
    if (facilityFilter) {
      emptyMsg =
        'No referrals involve this facility yet. Clear the facility filter to see all Tasks from FHIR.';
    } else if (query || (statusFilter && statusFilter !== 'all')) {
      emptyMsg = 'No incoming referrals match the current filters.';
    }
    body.innerHTML = `<tr class="placeholder-row"><td colspan="8" class="placeholder">${escapeHtml(
      emptyMsg
    )}</td></tr>`;
    return;
  }

  body.innerHTML = referrals
    .map((r) => {
      const referralId = r.localCode || r.requisitionValue || r.taskFhirId || '-';
      const patient = r.patientName || '-';
      const from = r.sendingOrgName || '-';
      const to = r.receivingOrgName || '-';
      const category = r.categoryText || r.categoryDisplay || '-';
      return `<tr>
        <td>
          <code title="${escapeHtml(referralId)}">${escapeHtml(referralId)}</code>
          ${
            r.requisitionValue && r.localCode && r.requisitionValue !== r.localCode
              ? `<div class="muted cell-sub" title="${escapeHtml(r.requisitionValue)}">${escapeHtml(
                  r.requisitionValue
                )}</div>`
              : ''
          }
        </td>
        <td><span class="cell-ellipsis" title="${escapeHtml(patient)}">${escapeHtml(patient)}</span></td>
        <td><span class="cell-ellipsis" title="${escapeHtml(from)}">${escapeHtml(from)}</span></td>
        <td><span class="cell-ellipsis" title="${escapeHtml(to)}">${escapeHtml(to)}</span></td>
        <td><span class="cell-ellipsis" title="${escapeHtml(category)}">${escapeHtml(category)}</span></td>
        <td>
          ${statusTag(r.taskStatus)}
          ${
            r.missingTask
              ? `<div class="muted cell-sub">ServiceRequest only</div>`
              : ''
          }
        </td>
        <td class="col-when"><span class="cell-ellipsis" title="${escapeHtml(
          formatDateTime(r.dateOfReferral || r.createdAt)
        )}">${formatDateTime(r.dateOfReferral || r.createdAt)}</span></td>
        <td class="col-actions">${incomingActionButtons(r)}</td>
      </tr>`;
    })
    .join('');
}

async function loadInboxReferrals({
  q,
  status,
  receivingOrgFhirId,
  page,
  quiet = false,
  force = false,
} = {}) {
  const body = $('#inboxBody');
  const meta = $('#inboxMeta');
  if (!body) return;

  // Don't block inbox on facility dropdown load.
  const facilitiesPromise = ensureInboxFacilityFilter().catch(() => {});

  if (q !== undefined) {
    state.inbox.q = q;
    state.inbox.page = 1;
  }
  if (status !== undefined) {
    state.inbox.status = status;
    state.inbox.page = 1;
  }
  if (receivingOrgFhirId !== undefined) {
    state.inbox.receivingOrgFhirId = receivingOrgFhirId;
    state.inbox.page = 1;
  }
  if (page !== undefined) state.inbox.page = page;

  await facilitiesPromise;

  const query = state.inbox.q || $('#inboxSearch')?.value?.trim() || '';
  const statusFilter = state.inbox.status || $('#inboxStatusFilter')?.value || 'all';
  const facilityFilter =
    state.inbox.receivingOrgFhirId || $('#inboxReceivingFacilityFilter')?.value || '';
  state.inbox.q = query;
  state.inbox.status = statusFilter;
  state.inbox.source = 'fhir';
  state.inbox.receivingOrgFhirId = facilityFilter;

  if ($('#inboxSearch')) $('#inboxSearch').value = query;
  if ($('#inboxStatusFilter')) {
    $('#inboxStatusFilter').value = statusFilter;
    syncSearchableSelect($('#inboxStatusFilter'));
  }
  if ($('#inboxReceivingFacilityFilter')) {
    state.inbox.suppressFacilityChange = true;
    $('#inboxReceivingFacilityFilter').value = facilityFilter;
    syncSearchableSelect($('#inboxReceivingFacilityFilter'));
    setTimeout(() => {
      state.inbox.suppressFacilityChange = false;
    }, 0);
  }

  // Use cache only for quick paging within 5s; otherwise refetch so new peer referrals appear.
  const cacheAgeMs = state.inbox.cacheAt
    ? Date.now() - (Date.parse(state.inbox.cacheAt) || 0)
    : Number.POSITIVE_INFINITY;
  const cacheFresh = Number.isFinite(cacheAgeMs) && cacheAgeMs >= 0 && cacheAgeMs < 5000;
  const pagingOnly =
    page !== undefined &&
    q === undefined &&
    status === undefined &&
    receivingOrgFhirId === undefined;
  if (!force && pagingOnly && state.inbox.cache.length && cacheFresh) {
    renderInboxFromCache();
    return;
  }

  const requestId = ++state.inbox.requestId;
  state.inbox.loading = true;
  if (!quiet) {
    body.innerHTML = `<tr class="placeholder-row"><td colspan="8" class="placeholder">${inboxLoadingMessage()}</td></tr>`;
  }

  const fetchInbox = async () => {
    const params = new URLSearchParams({
      source: 'fhir',
      status: 'all',
      count: '100',
    });
    // Always include home facility inbound ServiceRequests on the server.
    // Only pass filter when user explicitly chose one.
    if (facilityFilter) params.set('receivingOrgFhirId', facilityFilter);
    const res = await fetch(`/api/incoming?${params}`);
    const data = await parseResponseJson(res, '/api/incoming');
    if (!res.ok) throw new Error(data?.error || 'Failed to load incoming referrals');
    return data;
  };

  try {
    let data;
    try {
      data = await fetchInbox();
    } catch (firstErr) {
      // CDR can flake; one retry before failing the inbox.
      await new Promise((r) => setTimeout(r, 800));
      if (requestId !== state.inbox.requestId) return;
      data = await fetchInbox();
    }
    if (requestId !== state.inbox.requestId) return;

    state.inbox.cache = data.referrals || [];
    state.inbox.cacheAt = new Date().toISOString();
    renderInboxFromCache();
    if (data.stale || data.source === 'fhir-cache') {
      showToast(
        data.warning || 'Showing last successful FHIR inbox while CDR recovers.',
        'warn',
        { title: 'Incoming (cached)' }
      );
    }
  } catch (err) {
    if (requestId !== state.inbox.requestId) return;
    if (!quiet) {
      if (state.inbox.cache.length) {
        renderInboxFromCache();
        showToast(err.message, 'warn', { title: 'Using cached inbox' });
      } else {
        body.innerHTML = `<tr class="placeholder-row"><td colspan="8" class="placeholder">${escapeHtml(
          err.message || 'Could not load incoming referrals'
        )}</td></tr>`;
        if (meta) meta.textContent = 'Error — click Refresh from FHIR';
        showToast(err.message, 'err', { title: 'Incoming referrals' });
      }
    }
  } finally {
    if (requestId === state.inbox.requestId) state.inbox.loading = false;
  }
}

function renderClinicalList(title, items, mapFn) {
  if (!items?.length) return '';
  return detailSection(
    title,
    items
      .map((item) => {
        const mapped = mapFn(item);
        return detailItem(mapped.label, mapped.value, { full: true });
      })
      .join('')
  );
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/fhir+json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderStatusTimeline(timeline = []) {
  if (!timeline.length) {
    return `<p class="muted">No Task history versions returned from FHIR.</p>`;
  }
  const items = timeline
    .map((row) => {
      const when = formatTime(row.lastUpdated) || '-';
      const status = displayValue(row.status);
      const business = row.businessStatus
        ? `<span class="timeline-pill">${escapeHtml(row.businessStatus)}</span>`
        : '';
      const note = row.note
        ? `<p class="timeline-note">${escapeHtml(row.note)}</p>`
        : '';
      const version = row.versionId ? `v${escapeHtml(row.versionId)}` : '';
      return `<li class="status-timeline-item">
        <div class="status-timeline-dot" aria-hidden="true"></div>
        <div class="status-timeline-card">
          <div class="status-timeline-head">
            <strong>${escapeHtml(status)}</strong>
            ${business}
            <span class="muted">${escapeHtml(when)}${version ? ` · ${version}` : ''}</span>
          </div>
          ${note}
        </div>
      </li>`;
    })
    .join('');
  return `<ol class="status-timeline">${items}</ol>`;
}

async function downloadReferralCollection(taskFhirId) {
  const id = String(taskFhirId || state.activeReferralView.taskFhirId || '').trim();
  if (!id) {
    showToast('No Task FHIR ID available for collection export.', 'err', {
      title: 'Collection package',
    });
    return;
  }
  try {
    const res = await fetch(`/api/incoming/task/${encodeURIComponent(id)}/collection`);
    const data = await parseResponseJson(res, '/api/incoming/task/.../collection');
    if (!res.ok) throw new Error(data?.error || 'Collection export failed');
    const filename = `eref-collection-${id}.json`;
    downloadJsonFile(filename, data.bundle);
    showToast(
      `Downloaded ${data.entryCount || data.bundle?.entry?.length || 0} resources as collection Bundle.`,
      'ok',
      { title: 'Collection package' }
    );
  } catch (err) {
    showToast(err.message, 'err', { title: 'Collection package' });
  }
}

async function loadReferralTaskHistory(
  taskFhirId,
  { targetSelector = null, root = document, quiet = false } = {}
) {
  const id = String(taskFhirId || state.activeReferralView.taskFhirId || '').trim();
  const mount =
    (targetSelector && root.querySelector(targetSelector)) ||
    root.querySelector('.referral-history-mount') ||
    document.querySelector('.referral-history-mount');
  if (!id) {
    if (!quiet) {
      showToast('No Task FHIR ID available for history.', 'err', { title: 'Status timeline' });
    }
    return;
  }
  if (mount) {
    mount.hidden = false;
    mount.innerHTML = detailSection(
      'Status timeline (Task history)',
      `<p class="muted">Loading Task history...</p>`
    );
  }
  try {
    const res = await fetch(`/api/incoming/task/${encodeURIComponent(id)}/history`);
    const data = await parseResponseJson(res, '/api/incoming/task/.../history');
    if (!res.ok) throw new Error(data?.error || 'History load failed');
    if (mount) {
      mount.innerHTML = detailSection(
        'Status timeline (Task history)',
        renderStatusTimeline(data.timeline || [])
      );
    }
    if (!quiet) {
      showToast(`${data.total || 0} Task version(s) loaded.`, 'ok', { title: 'Status timeline' });
    }
  } catch (err) {
    if (mount) {
      mount.innerHTML = detailSection(
        'Status timeline (Task history)',
        `<p class="muted">${escapeHtml(err.message)}</p>`
      );
    }
    if (!quiet) {
      showToast(err.message, 'err', { title: 'Status timeline' });
    }
  }
}

function referralPackageActionsHtml(taskFhirId) {
  if (!taskFhirId) return '';
  return `<div class="referral-history-mount" data-task-id="${escapeHtml(taskFhirId)}">
    ${detailSection(
      'Status timeline (Task history)',
      `<p class="muted">Loading Task history...</p>`
    )}
  </div>`;
}

function openIncomingPackageModal(payload) {
  const referral = payload.referral || payload.package?.summary || {};
  const pkg = payload.package;
  const clinical = pkg?.clinical || {};
  const resources = pkg?.resources || {};
  const taskFhirId = referral.taskFhirId || resources.task?.id || null;

  state.activeReferralView = {
    taskFhirId,
    localId: referral.id || null,
  };

  setRecordMeta({
    kicker: 'Incoming Referral',
    title: referral.patientName || 'Incoming Referral',
    subtitle: referral.taskFhirId
      ? `Task ${referral.taskFhirId}`
      : referral.localCode || 'Referral package',
    syncStatus: referral.syncStatus,
    statusText: referral.taskStatus,
    localCode: referral.localCode,
    source: referral.source || (pkg ? 'fhir-package' : 'local'),
    extraItems: [
      referral.direction,
      referral.serviceRequestFhirId ? `SR ${referral.serviceRequestFhirId}` : null,
    ].filter(Boolean),
  });

  const sections = [
    referralPackageActionsHtml(taskFhirId),
    detailSection(
      'Parties',
      [
        detailItem('Patient', referral.patientName),
        detailItem('Patient FHIR ID', referral.patientFhirId),
        detailItem('From facility', referral.sendingOrgName),
        detailItem('From practitioner', referral.sendingPracName),
        detailItem('To facility', referral.receivingOrgName),
        detailItem('To practitioner', referral.receivingPracName),
      ].join('')
    ),
    detailSection(
      'ServiceRequest / Task',
      [
        detailItem('Category', referral.categoryText || referral.categoryDisplay),
        detailItem('Reason', referral.reasonText, { full: true }),
        detailItem('Requisition', referral.requisitionValue),
        detailItem('Date of referral', referral.dateOfReferral || referral.createdAt),
        detailItem('ServiceRequest note', referral.referralNote, { full: true }),
        detailItem('Task note', referral.taskNote, { full: true }),
        detailItem('ServiceRequest ID', referral.serviceRequestFhirId),
        detailItem('Task ID', referral.taskFhirId),
        detailItem('Encounter ID', referral.encounterFhirId),
        detailItem('Task status', referral.taskStatus),
      ].join('')
    ),
    detailSection(
      'Clinical summary',
      [
        detailItem('Chief complaint', referral.chiefComplaint || clinical.conditions?.[0]?.text, {
          full: true,
        }),
        detailItem(
          'Working impression',
          referral.workingImpression || clinical.conditions?.[1]?.text,
          { full: true }
        ),
        detailItem('Clinical history', referral.clinicalHistory, { full: true }),
        detailItem('Treatment given', referral.treatmentGiven, { full: true }),
        detailItem('Lab conclusion', referral.labConclusion, { full: true }),
      ].join('')
    ),
  ];

  if (clinical.conditions?.length) {
    sections.push(
      renderClinicalList('Conditions', clinical.conditions, (c) => ({
        label: c.category || c.display || 'Condition',
        value: [c.text, c.clinicalStatus, c.note].filter(Boolean).join(' · '),
      }))
    );
  }
  if (clinical.observations?.length) {
    sections.push(
      renderClinicalList('Observations / Vitals', clinical.observations, (o) => ({
        label: o.display || o.code || 'Observation',
        value: [o.value, o.effectiveDateTime, o.status].filter(Boolean).join(' · '),
      }))
    );
  }
  if (clinical.procedures?.length) {
    sections.push(
      renderClinicalList('Procedures', clinical.procedures, (p) => ({
        label: p.display || 'Procedure',
        value: [p.note, p.status].filter(Boolean).join(' · '),
      }))
    );
  }
  if (clinical.diagnosticReports?.length) {
    sections.push(
      renderClinicalList('DiagnosticReport', clinical.diagnosticReports, (d) => ({
        label: d.title || d.display || 'Report',
        value: [d.conclusion, d.status].filter(Boolean).join(' · '),
      }))
    );
  }

  const loaded = [
    resources.task && 'Task',
    resources.serviceRequest && 'ServiceRequest',
    resources.patient && 'Patient',
    resources.encounter && 'Encounter',
    resources.sendingOrganization && 'Sending Organization',
    resources.receivingOrganization && 'Receiving Organization',
    resources.sendingPractitioner && 'Sending Practitioner',
    resources.receivingPractitioner && 'Receiving Practitioner',
    resources.sendingPractitionerRole && 'Sending PractitionerRole',
    resources.receivingPractitionerRole && 'Receiving PractitionerRole',
    resources.conditions?.length && `Condition x${resources.conditions.length}`,
    resources.observations?.length && `Observation x${resources.observations.length}`,
    resources.procedures?.length && `Procedure x${resources.procedures.length}`,
    resources.diagnosticReports?.length && `DiagnosticReport x${resources.diagnosticReports.length}`,
  ].filter(Boolean);

  if (loaded.length) {
    sections.push(
      detailSection(
        'FHIR resources loaded',
        detailItem('Package', loaded.join(', '), { full: true })
      )
    );
  }

  if (payload.warning) {
    sections.push(
      detailSection('Warning', detailItem('Hydration', payload.warning, { full: true }))
    );
  }

  $('#recordViewBody').innerHTML = sections.join('');
  openRecordModal();
  if (taskFhirId) {
    loadReferralTaskHistory(taskFhirId, {
      root: $('#recordViewModal') || document,
      quiet: true,
    });
  }
}

async function openIncoming(mode, { id, taskId }) {
  try {
    let res;
    if (id) {
      res = await fetch(`/api/incoming/${id}?hydrate=true`);
    } else if (taskId) {
      res = await fetch(`/api/incoming/task/${encodeURIComponent(taskId)}`);
    } else {
      return;
    }
    const data = await parseResponseJson(res, '/api/incoming');
    if (!res.ok) throw new Error(data?.error || 'Incoming referral not found');
    if (mode === 'view') openIncomingPackageModal(data);
  } catch (err) {
    showToast(err.message, 'err', { title: 'Incoming referral' });
  }
}

async function updateIncomingStatus({ id, taskId, serviceRequestId }, status) {
  await withProgress(
    {
      title: status === 'accepted' ? 'Accepting referral' : 'Updating referral',
      message: `Setting status to ${status}...`,
      steps: [
        serviceRequestId && !taskId
          ? 'Create/update FHIR Task from ServiceRequest'
          : 'Update FHIR Task',
        'Refresh incoming list',
      ],
    },
    async ({ setProgressStep, completeProgressModal }) => {
      setProgressStep(0, 'active');
      const url = id
        ? `/api/incoming/${id}/status`
        : taskId
          ? `/api/incoming/task/${encodeURIComponent(taskId)}/status`
          : `/api/incoming/servicerequest/${encodeURIComponent(serviceRequestId)}/status`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Status update failed');
      setProgressStep(0, 'done');
      setProgressStep(1, 'active');
      await loadInboxReferrals({ force: true });
      loadDashboard();
      setProgressStep(1, 'done');
      completeProgressModal(true);
      showToast(
        data.taskCreated
          ? `Referral ${status} (Task ${data.taskFhirId} created)`
          : `Referral marked as ${status}`,
        'ok',
        { title: 'Referral updated' }
      );
    }
  );
}

function closeTransferReferralModal() {
  const modal = $('#transferReferralModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  const form = $('#transferReferralForm');
  if (form) form.reset();
}

function fillTransferPractitionerRoles(orgFhirId = '') {
  const roles = state.transferLookups.practitionerRoles || [];
  const organizations = state.transferLookups.organizations || [];
  let filtered = orgFhirId
    ? roles.filter((r) => String(r.organizationFhirId || '') === String(orgFhirId))
    : roles;
  if (orgFhirId && !filtered.length && roles.length) filtered = roles;

  fillSelect($('#transferReceivingPracId'), filtered, {
    valueKey: 'fhirId',
    placeholder: filtered.length
      ? '-- Select Receiving Doctor / Practitioner --'
      : orgFhirId
        ? 'No practitioner roles for this facility'
        : 'Select a facility first',
    labelFn: (r) => practitionerRoleLabel(r, organizations),
  });
}

async function ensureTransferLookups() {
  if (state.transferLookups.loaded || state.transferLookups.loading) {
    if (state.transferLookups.loading) {
      for (let i = 0; i < 40 && state.transferLookups.loading; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    return state.transferLookups;
  }

  state.transferLookups.loading = true;
  try {
    const [orgsRes, rolesRes] = await Promise.all([
      fetch('/api/organizations?source=fhir&count=200'),
      fetch('/api/practitioners/roles?count=200'),
    ]);
    const orgsData = await orgsRes.json().catch(() => ({ organizations: [] }));
    const rolesData = await rolesRes.json().catch(() => ({ roles: [] }));
    if (!orgsRes.ok) throw new Error(orgsData.error || 'Could not load facilities');
    if (!rolesRes.ok) throw new Error(rolesData.error || 'Could not load practitioner roles');

    const byFhirId = new Map();
    (orgsData.organizations || []).forEach((o) => {
      if (!o?.fhirId) return;
      byFhirId.set(String(o.fhirId), {
        ...o,
        fhirId: String(o.fhirId),
        name: o.name || o.fhirId,
      });
    });

    state.transferLookups.organizations = [...byFhirId.values()].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''))
    );
    state.transferLookups.practitionerRoles = (rolesData.roles || []).filter((r) => r.fhirId);
    state.transferLookups.loaded = true;
  } finally {
    state.transferLookups.loading = false;
  }
  return state.transferLookups;
}

async function openTransferReferralModal({
  taskId,
  patientName = '',
  receivingOrgFhirId = '',
  receivingOrgName = '',
} = {}) {
  const modal = $('#transferReferralModal');
  const form = $('#transferReferralForm');
  if (!modal || !form || !taskId) return;

  form.reset();
  $('#transferTaskFhirId').value = taskId;
  $('#transferCurrentOrgFhirId').value = receivingOrgFhirId || '';
  $('#transferReferralContext').textContent = [
    patientName ? `Patient: ${patientName}` : null,
    receivingOrgName ? `Current destination: ${receivingOrgName}` : null,
    `Task ${taskId}`,
  ]
    .filter(Boolean)
    .join(' · ');

  fillSelect($('#transferReceivingOrgId'), [], {
    valueKey: 'fhirId',
    placeholder: 'Loading facilities...',
  });
  fillSelect($('#transferReceivingPracId'), [], {
    valueKey: 'fhirId',
    placeholder: 'Loading practitioners...',
  });

  modal.hidden = false;
  document.body.style.overflow = 'hidden';

  try {
    await ensureTransferLookups();
    const currentOrg = String(receivingOrgFhirId || '').trim();
    const facilities = (state.transferLookups.organizations || []).filter(
      (o) => !currentOrg || String(o.fhirId) !== currentOrg
    );
    fillSelect($('#transferReceivingOrgId'), facilities, {
      valueKey: 'fhirId',
      placeholder: facilities.length
        ? 'Select receiving facility...'
        : 'No other facilities available',
      labelFn: (o) =>
        `${o.name || '-'}${o.nhfrCode && o.nhfrCode !== '-' ? ` (${o.nhfrCode})` : ''}`,
    });
    fillTransferPractitionerRoles('');
  } catch (err) {
    showToast(err.message || 'Could not load transfer options', 'err', {
      title: 'Transfer referral',
    });
  }
}

async function submitTransferReferral(e) {
  e?.preventDefault?.();
  const form = $('#transferReferralForm');
  if (!form) return;

  const taskId = $('#transferTaskFhirId')?.value?.trim();
  const orgId = $('#transferReceivingOrgId')?.value?.trim();
  const roleId = $('#transferReceivingPracId')?.value?.trim();
  const reason = $('#transferReason')?.value?.trim();
  const currentOrg = $('#transferCurrentOrgFhirId')?.value?.trim();

  if (!taskId) {
    showToast('Missing Task ID for transfer.', 'err', { title: 'Transfer' });
    return;
  }
  if (!orgId || !roleId || !reason) {
    showToast('Facility, practitioner, and transfer reason are required.', 'err', {
      title: 'Transfer',
    });
    return;
  }
  if (currentOrg && orgId === currentOrg) {
    showToast('Choose a different receiving facility.', 'err', { title: 'Transfer' });
    return;
  }

  const org = (state.transferLookups.organizations || []).find(
    (o) => String(o.fhirId) === String(orgId)
  );
  const role = (state.transferLookups.practitionerRoles || []).find(
    (r) => String(r.fhirId) === String(roleId)
  );

  const btn = $('#transferReferralSubmitBtn');
  if (btn) btn.disabled = true;

  try {
    await withProgress(
      {
        title: 'Transferring referral',
        message: 'Updating Task owner and ServiceRequest performer on FHIR...',
        steps: ['Update FHIR Task / ServiceRequest', 'Refresh incoming list'],
      },
      async ({ setProgressStep, completeProgressModal }) => {
        setProgressStep(0, 'active');
        const res = await fetch(`/api/incoming/task/${encodeURIComponent(taskId)}/transfer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receivingOrgFhirId: orgId,
            receivingPracRoleFhirId: roleId,
            receivingOrgName: org?.name || selectedOptionLabel($('#transferReceivingOrgId')),
            receivingPracName:
              role?.practitionerName || selectedOptionLabel($('#transferReceivingPracId')),
            reason,
          }),
        });
        const data = await parseResponseJson(res, '/api/incoming/.../transfer');
        if (!res.ok) throw new Error(data?.error || 'Transfer failed');
        setProgressStep(0, 'done');
        setProgressStep(1, 'active');
        closeTransferReferralModal();
        await loadInboxReferrals({ force: true });
        loadDashboard();
        setProgressStep(1, 'done');
        completeProgressModal(true);
        showToast(
          `Referral transferred to ${data.receivingOrgName || org?.name || 'new facility'}`,
          'ok',
          { title: 'Transfer complete' }
        );
      }
    );
  } catch (err) {
    showToast(err.message || 'Transfer failed', 'err', { title: 'Transfer failed' });
  } finally {
    if (btn) btn.disabled = false;
  }
}

function validateReferralForm(form) {
  if (!validateForm(form)) return false;

  const sendingOrgFhirId = form.sendingOrgFhirId?.value;
  const receivingOrgFhirId = form.receivingOrgFhirId?.value;
  if (!sendingOrgFhirId || !receivingOrgFhirId) {
    showToast('Select sending and receiving facilities.', 'err', { title: 'Validation' });
    return false;
  }
  if (!form.patientFhirId?.value && !form.patientId?.value) {
    showToast('Select a patient.', 'err', { title: 'Validation' });
    openPatientPickerModal();
    return false;
  }
  if (sendingOrgFhirId === receivingOrgFhirId) {
    showToast('Sending and receiving facilities must be different.', 'err', {
      title: 'Validation',
    });
    return false;
  }
  if (!form.workingImpressionCode?.value || !form.workingImpression?.value) {
    showToast('Select a Working Impression (Diagnosis) from the SNOMED search.', 'err', {
      title: 'Validation',
    });
    return false;
  }
  return true;
}

function selectedOptionLabel(selectEl) {
  if (!selectEl) return '';
  const opt = selectEl.selectedOptions?.[0];
  if (!opt || !opt.value) return '';
  return String(opt.textContent || '').trim();
}

function findReferralRole(roleFhirId) {
  if (!roleFhirId) return null;
  const roles = state.referralLookups?.practitionerRoles || [];
  return roles.find((r) => String(r.fhirId) === String(roleFhirId)) || null;
}

function findReferralOrg(orgFhirId) {
  if (!orgFhirId) return null;
  const orgs = state.referralLookups?.organizations || [];
  return orgs.find((o) => String(o.fhirId) === String(orgFhirId)) || null;
}

function buildReferralPayload(form) {
  const payload = Object.fromEntries(new FormData(form).entries());

  // Prefer live select values (Select2-safe).
  const sendingOrgFhirId =
    $('#referralSendingOrgId')?.value || payload.sendingOrgFhirId || '';
  const receivingOrgFhirId =
    $('#referralReceivingOrgId')?.value || payload.receivingOrgFhirId || '';
  const sendingPracRoleFhirId =
    $('#referralSendingPracId')?.value || payload.sendingPracRoleFhirId || '';
  const receivingPracRoleFhirId =
    $('#referralReceivingPracId')?.value || payload.receivingPracRoleFhirId || '';

  payload.sendingOrgFhirId = sendingOrgFhirId;
  payload.receivingOrgFhirId = receivingOrgFhirId;
  payload.sendingPracRoleFhirId = sendingPracRoleFhirId;
  payload.receivingPracRoleFhirId = receivingPracRoleFhirId;

  payload.dateOfReferral = fromLocalDateTimeValue(payload.dateOfReferralLocal);
  delete payload.dateOfReferralLocal;

  [
    'bpSystolic',
    'bpDiastolic',
    'heartRate',
    'respiratoryRate',
    'temperature',
    'weight',
  ].forEach((k) => {
    if (payload[k] === '') delete payload[k];
  });

  const patientName = $('#referralPatientName')?.textContent?.trim();
  if (patientName && patientName !== '-') payload.patientName = patientName;

  const patientFhir =
    form.patientFhirId?.value ||
    $('#referralPatientFhirId')?.value ||
    $('#referralPatientFhir')?.textContent?.trim();
  if (patientFhir && patientFhir !== '-') payload.patientFhirId = patientFhir;

  const sendingRole = findReferralRole(sendingPracRoleFhirId);
  const receivingRole = findReferralRole(receivingPracRoleFhirId);
  const sendingOrg =
    findReferralOrg(sendingOrgFhirId) ||
    findReferralOrg(sendingRole?.organizationFhirId);
  const receivingOrg =
    findReferralOrg(receivingOrgFhirId) ||
    findReferralOrg(receivingRole?.organizationFhirId);

  // Fill organization refs from selected PractitionerRoles when needed.
  if (!payload.sendingOrgFhirId && sendingRole?.organizationFhirId) {
    payload.sendingOrgFhirId = String(sendingRole.organizationFhirId);
  }
  if (!payload.receivingOrgFhirId && receivingRole?.organizationFhirId) {
    payload.receivingOrgFhirId = String(receivingRole.organizationFhirId);
  }
  if (sendingRole?.organizationFhirId) {
    payload.sendingRoleOrganizationFhirId = String(sendingRole.organizationFhirId);
  }
  if (receivingRole?.organizationFhirId) {
    payload.receivingRoleOrganizationFhirId = String(receivingRole.organizationFhirId);
  }

  const sendingOrgName =
    selectedOptionLabel($('#referralSendingOrgId')) || sendingOrg?.name || '';
  const receivingOrgName =
    selectedOptionLabel($('#referralReceivingOrgId')) || receivingOrg?.name || '';
  const sendingPracRoleDisplay =
    selectedOptionLabel($('#referralSendingPracId')) ||
    (sendingRole ? practitionerRoleLabel(sendingRole, state.referralLookups.organizations || []) : '');
  const receivingPracRoleDisplay =
    selectedOptionLabel($('#referralReceivingPracId')) ||
    (receivingRole
      ? practitionerRoleLabel(receivingRole, state.referralLookups.organizations || [])
      : '');

  if (sendingOrgName) payload.sendingOrgName = sendingOrgName;
  if (receivingOrgName) payload.receivingOrgName = receivingOrgName;
  if (sendingPracRoleDisplay) payload.sendingPracRoleDisplay = sendingPracRoleDisplay;
  if (receivingPracRoleDisplay) payload.receivingPracRoleDisplay = receivingPracRoleDisplay;

  const categoryOpt = form.categoryCode?.selectedOptions?.[0];
  if (categoryOpt?.value) {
    payload.categoryDisplay = categoryOpt.textContent?.trim();
    payload.categoryText = categoryOpt.textContent?.trim();
  }
  const reasonOpt = form.reasonCode?.selectedOptions?.[0];
  if (reasonOpt?.value) {
    payload.reasonDisplay = reasonOpt.textContent?.trim();
  }

  return payload;
}

function closeFhirBundlePreviewModal() {
  const modal = $('#fhirBundlePreviewModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
}

function openFhirBundlePreviewModal(preview) {
  const modal = $('#fhirBundlePreviewModal');
  if (!modal || !preview?.bundle) return;

  const requisition = preview.requisitionValue || preview.bundle?.id || 'Bundle';
  $('#fhirBundlePreviewTitle').textContent = 'Preview FHIR Bundle';
  $('#fhirBundlePreviewSubtitle').textContent = preview.patientName
    ? `${preview.patientName} · ${requisition}`
    : `Draft transaction Bundle · ${requisition}`;

  const types = Array.isArray(preview.resourceTypes) ? preview.resourceTypes : [];
  $('#fhirBundlePreviewChips').innerHTML = [
    `<span class="modal-meta-item muted">${escapeHtml(String(preview.entryCount || 0))} entries</span>`,
    types.length
      ? `<span class="modal-meta-sep" aria-hidden="true"></span><span class="modal-meta-item muted">${escapeHtml(
          types.join(', ')
        )}</span>`
      : '',
    preview.sendingOrgName && preview.receivingOrgName
      ? `<span class="modal-meta-sep" aria-hidden="true"></span><span class="modal-meta-item muted">${escapeHtml(
          preview.sendingOrgName
        )} → ${escapeHtml(preview.receivingOrgName)}</span>`
      : '',
    preview.draft
      ? `<span class="modal-meta-sep" aria-hidden="true"></span><span class="modal-meta-item muted">Draft preview</span>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const codeEl = $('#fhirBundlePreviewCode');
  if (codeEl) {
    codeEl.textContent = JSON.stringify(
      {
        bundle: preview.bundle,
        labAttachment: preview.labAttachment ?? null,
      },
      null,
      2
    );
    codeEl.scrollTop = 0;
  }

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  codeEl?.focus();
}

async function previewReferralBundle() {
  const form = $('#referralForm');
  if (!form) return;

  const previewBtn = $('#previewReferralBundleBtn');
  const refreshBtn = $('#fhirBundlePreviewRefreshBtn');
  if (previewBtn) previewBtn.disabled = true;
  if (refreshBtn) refreshBtn.disabled = true;

  const payload = buildReferralPayload(form);

  try {
    const res = await fetch('/api/referrals/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bundle preview failed');
    openFhirBundlePreviewModal(data);
  } catch (err) {
    showToast(err.message, 'err', { title: 'Preview failed' });
  } finally {
    if (previewBtn) previewBtn.disabled = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

async function saveReferral(e) {
  e.preventDefault();
  const form = e.target;
  if (!validateReferralForm(form)) return;

  const btn = $('#submitReferralBtn');
  const previewSubmitBtn = $('#fhirBundlePreviewSubmitBtn');
  if (btn) btn.disabled = true;
  if (previewSubmitBtn) previewSubmitBtn.disabled = true;

  const payload = buildReferralPayload(form);

  try {
    await withProgress(
      {
        title: 'Submitting referral',
        message: 'Syncing parties and posting FHIR transaction Bundle...',
        steps: ['Validate parties', 'Build ServiceRequest + Task Bundle', 'Submit to FHIR'],
      },
      async ({ setProgressStep, completeProgressModal }) => {
        setProgressStep(0, 'active');
        setProgressStep(0, 'done');
        setProgressStep(1, 'active');
        setProgressStep(1, 'done');
        setProgressStep(2, 'active');

        const res = await fetch('/api/referrals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Referral submit failed');

        setProgressStep(2, 'done');
        completeProgressModal(true);

        const referral = data.referral;
        const srId =
          referral?.serviceRequestFhirId || data.fhir?.serviceRequestId || null;
        if (referral?.syncStatus === 'synced' || srId) {
          showToast(
            `Referral ${referral?.localCode || ''} submitted. ServiceRequest ${srId || '-'}`,
            'ok',
            { title: 'Referral created' }
          );
        } else {
          showToast(
            `FHIR sync failed: ${referral?.syncError || 'unknown'}`,
            'warn',
            { title: 'Submit incomplete' }
          );
        }

        closeFhirBundlePreviewModal();
        form.reset();
        delete form.dataset.seeded;
        clearReferralPatientPicker();
        initAllSearchableSelects(form);
        loadDashboard();
        setView('sent');
      }
    );
  } catch (err) {
    showToast(err.message, 'err', { title: 'Submit failed' });
  } finally {
    if (btn) btn.disabled = false;
    if (previewSubmitBtn) previewSubmitBtn.disabled = false;
  }
}

async function savePatient(e) {
  e.preventDefault();

  const form = e.target;
  if (!validateForm(form)) return;

  const btn = $('#savePatientBtn');
  btn.disabled = true;

  const payload = Object.fromEntries(new FormData(form).entries());
  delete payload.editId;
  delete payload.editFhirId;

  const editId = $('#patientEditId').value;
  const editFhirId = $('#patientEditFhirId').value;

  try {
    await runSaveWithFhirProgress(
      {
        title: state.formMode === 'edit' ? 'Saving changes' : 'Saving patient',
        entityLabel: 'patient',
      },
      async ({ setProgressStep, completeProgressModal }) => {
        let res;
        if (state.formMode === 'edit' && editId) {
          res = await fetch(`/api/patients/${editId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else if (state.formMode === 'edit' && editFhirId) {
          res = await fetch(`/api/patients/fhir/${encodeURIComponent(editFhirId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else {
          res = await fetch('/api/patients', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');

        const nowIso = new Date().toISOString();
        const patient = data.patient || {
          ...payload,
          fhirId: data.fhir?.id || data.fhir?.sourceId || null,
          syncStatus: data.fhir?.id ? 'synced' : 'pending',
          source: data.fhir?.id ? 'fhir' : 'local',
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        if (!patient.fhirId && data.fhir?.id) patient.fhirId = data.fhir.id;
        if (!patient.createdAt) patient.createdAt = nowIso;
        if (!patient.updatedAt) patient.updatedAt = nowIso;

        if (patient?.syncStatus === 'synced' || data.fhir?.id) {
          setProgressStep(1, 'done');
          completeProgressModal(true);
          showToast(`Saved - FHIR ID ${patient?.fhirId || data.fhir?.id}`, 'ok', {
            title: 'Patient saved',
          });
        } else if (patient?.syncStatus === 'failed') {
          setProgressStep(1, 'err');
          showToast(`Saved locally, FHIR sync failed: ${patient.syncError || 'unknown'}`, 'warn', {
            title: 'Partial save',
          });
        } else {
          setProgressStep(1, 'done');
          completeProgressModal(true);
          showToast('Patient saved', 'ok');
        }

        const wasCreate = !(editId || editFhirId);
        state.formMode = 'create';
        if (wasCreate) {
          state.patients.page = 1;
          // Clear an active filter so the newly registered patient is visible immediately.
          if (state.patients.q && patient && !patientMatchesSearch(patient, state.patients.q)) {
            state.patients.q = '';
            const searchInput = $('#patientSearchInput');
            if (searchInput) searchInput.value = '';
          }
          rememberRecentPatient(patient);
          upsertPatientRealtime(
            {
              ...patient,
              createdAt: patient.createdAt || nowIso,
              updatedAt: patient.updatedAt || nowIso,
            },
            'created'
          );
        } else if (patient) {
          rememberRecentPatient(patient);
          upsertPatientRealtime(patient, 'updated');
        }
        setView('patients');
        // FHIR search can lag; keep the row visible then refresh again shortly.
        schedulePatientsReload({ silent: true, delay: 1500 });
        setTimeout(() => loadPatients({ silent: true }), 4500);
      }
    );
  } catch (err) {
    showToast(err.message, 'err', { title: 'Save failed' });
  } finally {
    btn.disabled = false;
  }
}

async function saveOrganization(e) {
  e.preventDefault();
  const form = e.target;
  if (!validateForm(form)) return;

  const btn = $('#saveOrganizationBtn');
  btn.disabled = true;

  const payload = Object.fromEntries(new FormData(form).entries());
  delete payload.editId;
  delete payload.editFhirId;

  const editId = $('#organizationEditId').value;
  const editFhirId = $('#organizationEditFhirId').value;

  try {
    await runSaveWithFhirProgress(
      {
        title: state.orgFormMode === 'edit' ? 'Saving changes' : 'Saving organization',
        entityLabel: 'organization',
      },
      async ({ setProgressStep, completeProgressModal }) => {
        let res;
        if (state.orgFormMode === 'edit' && editId) {
          res = await fetch(`/api/organizations/${editId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else if (state.orgFormMode === 'edit' && editFhirId) {
          res = await fetch(`/api/organizations/fhir/${encodeURIComponent(editFhirId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else {
          res = await fetch('/api/organizations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');

        const organization = data.organization;
        if (organization?.syncStatus === 'synced' || data.fhir?.id) {
          setProgressStep(1, 'done');
          completeProgressModal(true);
          showToast(
            `Saved locally + FHIR ID ${organization?.fhirId || data.fhir?.id}`,
            'ok',
            { title: 'Organization saved' }
          );
        } else {
          setProgressStep(1, 'err');
          showToast(
            `Saved locally, FHIR sync failed: ${organization?.syncError || 'unknown'}`,
            'warn',
            { title: 'Partial save' }
          );
        }
        state.orgFormMode = 'create';
        form.reset();
        delete form.dataset.seeded;
        setView('organizations');
      }
    );
  } catch (err) {
    showToast(err.message, 'err', { title: 'Save failed' });
  } finally {
    btn.disabled = false;
  }
}

async function savePractitioner(e) {
  e.preventDefault();
  const form = e.target;
  syncRoleSpecialtyHidden(form);
  if (!validateForm(form)) return;

  const isQuick = form.id === 'practitionerQuickForm';
  const btn = isQuick ? $('#savePractitionerQuickBtn') : $('#savePractitionerBtn');
  btn.disabled = true;

  const payload = isQuick
    ? buildPractitionerPayloadFromForm(form)
    : Object.fromEntries(new FormData(form).entries());
  if (!isQuick) {
    delete payload.editId;
    delete payload.editFhirId;
    delete payload.roleSpecialty;
  }

  const editId = isQuick
    ? $('#practitionerQuickEditId').value
    : $('#practitionerEditId').value;
  const editFhirId = isQuick
    ? $('#practitionerQuickEditFhirId').value
    : $('#practitionerEditFhirId').value;
  const editRoleFhirId = isQuick
    ? $('#practitionerQuickEditRoleFhirId')?.value
    : $('#practitionerEditRoleFhirId')?.value;

  if (editRoleFhirId) {
    payload.roleFhirId = editRoleFhirId;
  }

  try {
    await runSaveWithFhirProgress(
      {
        title:
          state.pracFormMode === 'edit'
            ? 'Saving Practitioner & Role'
            : 'Saving Practitioner & Role Bundle',
        entityLabel: 'practitioner & role',
      },
      async ({ setProgressStep, completeProgressModal }) => {
        let res;
        if (state.pracFormMode === 'edit' && editId) {
          res = await fetch(`/api/practitioners/${editId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else if (state.pracFormMode === 'edit' && editFhirId) {
          res = await fetch(
            `/api/practitioners/fhir/${encodeURIComponent(editFhirId)}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }
          );
        } else {
          res = await fetch('/api/practitioners', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');

        if (data.practitioner?.syncStatus === 'failed') {
          setProgressStep(1, 'err');
        } else {
          setProgressStep(1, 'done');
          completeProgressModal(true);
        }

        const practitioner = data.practitioner;
        const pracId = practitioner?.fhirId || data.fhir?.id;
        const roleId = data.role?.id ? ` | Role FHIR: ${data.role.id}` : '';
        if (practitioner?.syncStatus === 'synced' || pracId) {
          showToast(
            `Saved FHIR Bundle: Practitioner ${pracId}${roleId}`,
            'ok',
            { title: 'Practitioner & Role saved' }
          );
        } else if (practitioner?.syncStatus === 'failed') {
          showToast(
            `Saved locally, FHIR sync failed: ${
              practitioner?.syncError || 'unknown'
            }`,
            'warn',
            { title: 'Partial save' }
          );
        }
        const wasCreate = !(editId || editFhirId);
        state.pracFormMode = 'create';
        form.reset();
        delete form.dataset.seeded;
        if (practitioner) {
          const stamped = {
            ...practitioner,
            createdAt: practitioner.createdAt || new Date().toISOString(),
            updatedAt: practitioner.updatedAt || new Date().toISOString(),
          };
          rememberRecentPractitioner(stamped);
          upsertPractitionerRealtime(stamped, wasCreate ? 'created' : 'updated');
          state.practitioners.page = 1;
        }
        if (isQuick) {
          closePractitionerQuickModal();
          schedulePractitionersReload({ silent: true, delay: 1200 });
        } else {
          setView('practitioners');
          schedulePractitionersReload({ silent: true, delay: 1200 });
        }
      }
    );
  } catch (err) {
    showToast(err.message, 'err', { title: 'Save failed' });
  } finally {
    btn.disabled = false;
  }
}

async function savePractitionerRole(e) {
  e.preventDefault();
  const form = e.target;
  const isQuick = form.id === 'practitionerRoleQuickForm';
  syncRoleSpecialtyHidden(form);
  syncRoleFormHiddenFields();
  if (isQuick) syncRoleQuickHiddenFields();
  if (!validateForm(form)) return;

  if (!form.practitionerFhirId?.value) {
    showToast('Select a practitioner with a FHIR ID', 'warn', { title: 'Missing practitioner' });
    return;
  }
  if (!form.organizationFhirId?.value) {
    showToast('Select an organization / facility', 'warn', { title: 'Missing organization' });
    return;
  }
  if (!form.roleCode?.value || !form.roleDisplay?.value) {
    showToast('Select a role / specialty', 'warn', { title: 'Missing role' });
    return;
  }
  const prcHidden = isQuick ? $('#practitionerRoleQuickPrcId') : form.prcId;
  if (!prcHidden?.value) {
    showToast('Selected practitioner is missing a PRC license number', 'warn', {
      title: 'Missing PRC ID',
    });
    return;
  }

  const btn = isQuick ? $('#savePractitionerRoleQuickBtn') : $('#savePractitionerRoleBtn');
  btn.disabled = true;

  const payload = Object.fromEntries(new FormData(form).entries());
  delete payload.editId;
  delete payload.editFhirId;
  delete payload.activeToggle;
  delete payload.roleSpecialty;
  if (isQuick) {
    payload.prcId = $('#practitionerRoleQuickPrcId')?.value || '';
    payload.practitionerName = $('#practitionerRoleQuickPractitionerName')?.value || '';
    payload.organizationName = $('#practitionerRoleQuickOrganizationName')?.value || '';
    payload.roleCode = $('#practitionerRoleQuickRoleCode')?.value || payload.roleCode;
    payload.roleDisplay = $('#practitionerRoleQuickRoleDisplay')?.value || payload.roleDisplay;
    payload.roleSystem =
      $('#practitionerRoleQuickRoleSystem')?.value || payload.roleSystem || DEFAULT_ROLE_SYSTEM;
  }
  payload.active = payload.active !== 'false';

  const editId = isQuick
    ? $('#practitionerRoleQuickEditId').value
    : $('#practitionerRoleEditId').value;
  const editFhirId = isQuick
    ? $('#practitionerRoleQuickEditFhirId').value
    : $('#practitionerRoleEditFhirId').value;

  try {
    await runSaveWithFhirProgress(
      {
        title: state.roleFormMode === 'edit' ? 'Saving changes' : 'Saving practitioner role',
        entityLabel: 'practitioner role',
      },
      async ({ setProgressStep, completeProgressModal }) => {
        let res;
        if (state.roleFormMode === 'edit' && editId) {
          res = await fetch(`/api/practitioner-roles/${editId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else if (state.roleFormMode === 'edit' && editFhirId) {
          res = await fetch(`/api/practitioner-roles/fhir/${encodeURIComponent(editFhirId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else {
          res = await fetch('/api/practitioner-roles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');

        if (data.role?.syncStatus === 'failed') {
          setProgressStep(1, 'err');
        } else {
          setProgressStep(1, 'done');
          completeProgressModal(true);
        }

        const role = data.role;
        if (role?.syncStatus === 'synced' || data.fhir?.id) {
          showToast(
            `Saved locally + FHIR ID ${role?.fhirId || data.fhir?.id}`,
            'ok',
            { title: 'Practitioner role saved' }
          );
        } else if (role?.syncStatus === 'failed') {
          showToast(
            `Saved locally, FHIR sync failed: ${role?.syncError || 'unknown'}`,
            'warn',
            { title: 'Partial save' }
          );
        }
        const wasCreate = !(editId || editFhirId);
        state.roleFormMode = 'create';
        form.reset();
        if (role) {
          const stamped = {
            ...role,
            createdAt: role.createdAt || new Date().toISOString(),
            updatedAt: role.updatedAt || new Date().toISOString(),
          };
          rememberRecentPractitionerRole(stamped);
          upsertPractitionerRoleRealtime(stamped, wasCreate ? 'created' : 'updated');
          state.practitionerRoles.page = 1;
        }
        if (isQuick) {
          closePractitionerRoleQuickModal();
          schedulePractitionerRolesReload({ silent: true, delay: 1200 });
        } else {
          setView('practitioner-roles');
          schedulePractitionerRolesReload({ silent: true, delay: 1200 });
        }
      }
    );
  } catch (err) {
    showToast(err.message, 'err', { title: 'Save failed' });
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('click', async (e) => {
  const recordTab = e.target.closest('[data-record-tab]');
  if (recordTab && !recordTab.disabled && $('#recordViewModal')?.contains(recordTab)) {
    e.preventDefault();
    const tabName = recordTab.dataset.recordTab;
    setRecordTab(tabName);
    if (tabName === 'history' && state.recordView?.entity === 'patient' && !state.recordView.historyLoaded) {
      loadPatientHistory({ quiet: false });
    }
    return;
  }

  const menuToggle = e.target.closest('.action-menu-toggle');
  if (menuToggle) {
    e.preventDefault();
    e.stopPropagation();
    const menu = menuToggle.closest('.action-menu');
    const wasOpen = menu?.classList.contains('open');
    closeAllActionMenus();
    if (menu && !wasOpen) {
      menu.classList.add('open');
      menuToggle.setAttribute('aria-expanded', 'true');
      positionActionMenu(menu);
    }
    return;
  }

  if (e.target.closest('.action-menu-item')) {
    closeAllActionMenus();
  } else if (!e.target.closest('.action-menu')) {
    closeAllActionMenus();
  }

  if (e.target.closest('[data-close-modal]')) {
    const closer = e.target.closest('[data-close-modal]');
    if (closer?.dataset?.closeModal === 'referralSync') {
      closeReferralSyncModal();
    } else if (closer?.dataset?.closeModal === 'patientPicker') {
      closePatientPickerModal();
    } else if (closer?.dataset?.closeModal === 'transferReferral') {
      closeTransferReferralModal();
    } else if (closer?.dataset?.closeModal === 'fhirBundlePreview') {
      closeFhirBundlePreviewModal();
    } else if (closer?.dataset?.closeModal === 'practitionerQuick') {
      closePractitionerQuickModal();
    } else if (closer?.dataset?.closeModal === 'practitionerRoleQuick') {
      closePractitionerRoleQuickModal();
    } else if (closer?.dataset?.closeModal === 'facilitySwitcher') {
      closeFacilitySwitcherModal();
    } else {
      closeRecordModal();
      closeReferralSyncModal();
      closePatientPickerModal();
      closeTransferReferralModal();
      closeFhirBundlePreviewModal();
      closeFacilitySwitcherModal();
    }
    return;
  }

  const facSwitcherBtn = e.target.closest('#facilitySwitcherBtn');
  if (facSwitcherBtn) {
    e.preventDefault();
    openFacilitySwitcherModal();
    return;
  }

  const packageBtn = e.target.closest('[data-action="download-collection"]');
  if (packageBtn) {
    e.preventDefault();
    const taskId = packageBtn.dataset.taskId || state.activeReferralView.taskFhirId;
    downloadReferralCollection(taskId);
    return;
  }

  const ddTrigger = e.target.closest('.nav-dd-trigger');
  if (ddTrigger) {
    e.preventDefault();
    e.stopPropagation();
    const dd = ddTrigger.closest('.nav-dd');
    const wasOpen = dd?.classList.contains('open');
    closeAllNavDropdowns();
    if (dd && !wasOpen) {
      dd.classList.add('open');
      ddTrigger.setAttribute('aria-expanded', 'true');
    }
    return;
  }

  if (!e.target.closest('.nav-dd')) {
    closeAllNavDropdowns();
  }

  const nav = e.target.closest('[data-view]');
  if (nav) {
    if (nav.dataset.view === 'patient-form' && !e.target.closest('[data-action]')) {
      state.formMode = 'create';
    }
    if (nav.dataset.view === 'organization-form' && !e.target.closest('[data-action]')) {
      state.orgFormMode = 'create';
    }
    if (nav.dataset.view === 'practitioner-form' && !e.target.closest('[data-action]')) {
      state.pracFormMode = 'create';
    }
    if (nav.dataset.view === 'practitioner-role-form' && !e.target.closest('[data-action]')) {
      state.roleFormMode = 'create';
    }
    closeRecordModal();
    closeReferralSyncModal();
    setView(nav.dataset.view);
    return;
  }

  const statusBtn = e.target.closest('[data-incoming-status], [data-referral-status]');
  if (statusBtn) {
    const id = statusBtn.dataset.id || null;
    const taskId = statusBtn.dataset.taskId || null;
    const serviceRequestId = statusBtn.dataset.srId || null;
    const status = statusBtn.dataset.incomingStatus || statusBtn.dataset.referralStatus;
    if ((!id && !taskId && !serviceRequestId) || !status) return;
    statusBtn.disabled = true;
    try {
      await updateIncomingStatus({ id, taskId, serviceRequestId }, status);
    } catch (err) {
      showToast(err.message, 'err', { title: 'Status update failed' });
    } finally {
      statusBtn.disabled = false;
    }
    return;
  }

  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    const action = actionBtn.dataset.action;
    const entity = actionBtn.dataset.entity || 'patient';
    const id = actionBtn.dataset.id || null;
    const fhirId = actionBtn.dataset.fhirId || null;
    const taskId = actionBtn.dataset.taskId || null;

    if (action === 'delete') {
      actionBtn.disabled = true;
      try {
        await deleteEntity(entity, { id, fhirId });
      } catch (err) {
        showToast(err.message, 'err', { title: 'Delete failed' });
      } finally {
        actionBtn.disabled = false;
      }
      return;
    }

    if (entity === 'organization') {
      if (action === 'view') openOrganization('view', { id, fhirId });
      if (action === 'edit') openOrganization('edit', { id, fhirId });
    } else if (entity === 'practitioner') {
      if (action === 'view') openPractitioner('view', { id, fhirId });
      if (action === 'edit') openPractitioner('edit', { id, fhirId });
    } else if (entity === 'practitioner-role') {
      if (action === 'view') openPractitionerRole('view', { id, fhirId });
      if (action === 'edit') openPractitionerRole('edit', { id, fhirId });
    } else if (entity === 'incoming' || entity === 'referral') {
      if (action === 'view') openIncoming('view', { id });
    } else if (entity === 'incoming-task') {
      if (action === 'view') openIncoming('view', { taskId });
      if (action === 'transfer') {
        openTransferReferralModal({
          taskId,
          patientName: actionBtn.dataset.patientName || '',
          receivingOrgFhirId: actionBtn.dataset.receivingOrgId || '',
          receivingOrgName: actionBtn.dataset.receivingOrgName || '',
        });
      }
    } else if (entity === 'sent-referral') {
      if (action === 'view') openSentReferral(id);
    } else {
      if (action === 'view') openPatient('view', { id, fhirId });
      if (action === 'edit') openPatient('edit', { id, fhirId });
    }
    return;
  }

  if (e.target.closest('#btnRefreshOrgs')) {
    const btn = $('#btnRefreshOrgs');
    btn.disabled = true;
    try {
      await withProgress(
        {
          title: 'Refreshing organizations',
          message: 'Fetching latest facilities from the FHIR server.',
          steps: ['Connect to FHIR', 'Load organizations'],
        },
        async ({ setProgressStep, completeProgressModal }) => {
          setProgressStep(0, 'active');
          setProgressStep(0, 'done');
          setProgressStep(1, 'active');
          state.organizations.page = 1;
          const ok = await loadOrganizations({ source: 'fhir' });
          if (!ok) throw new Error('Could not refresh organizations');
          setProgressStep(1, 'done');
          completeProgressModal(true);
          showToast('Organizations refreshed from FHIR', 'ok', { title: 'Refresh complete' });
        }
      );
    } catch (err) {
      if (err.message !== 'Could not refresh organizations') {
        showToast(err.message, 'err', { title: 'Refresh failed' });
      }
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (e.target.closest('#btnRefreshPracs')) {
    const btn = $('#btnRefreshPracs');
    btn.disabled = true;
    try {
      await withProgress(
        {
          title: 'Refreshing practitioners',
          message: 'Fetching latest clinicians from the FHIR server.',
          steps: ['Connect to FHIR', 'Load practitioners'],
        },
        async ({ setProgressStep, completeProgressModal }) => {
          setProgressStep(0, 'active');
          setProgressStep(0, 'done');
          setProgressStep(1, 'active');
          state.practitioners.page = 1;
          const ok = await loadPractitioners({ source: 'fhir' });
          if (!ok) throw new Error('Could not refresh practitioners');
          setProgressStep(1, 'done');
          completeProgressModal(true);
          showToast('Practitioners refreshed from FHIR', 'ok', { title: 'Refresh complete' });
        }
      );
    } catch (err) {
      if (err.message !== 'Could not refresh practitioners') {
        showToast(err.message, 'err', { title: 'Refresh failed' });
      }
    } finally {
      btn.disabled = false;
    }
    return;
  }


  const resyncOrg = e.target.closest('[data-resync-org]');
  if (resyncOrg) {
    resyncOrg.disabled = true;
    try {
      await withProgress(
        {
          title: 'Syncing organization',
          message: 'Pushing local facility record to FHIR.',
          steps: ['Prepare record', 'Sync to FHIR server'],
        },
        async ({ setProgressStep, completeProgressModal }) => {
          setProgressStep(0, 'done');
          setProgressStep(1, 'active');
          const res = await fetch(`/api/organizations/${resyncOrg.dataset.resyncOrg}/sync`, {
            method: 'POST',
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Sync failed');
          setProgressStep(1, 'done');
          completeProgressModal(true);
          showToast(`Synced FHIR ID ${data.organization.fhirId}`, 'ok', { title: 'Sync complete' });
          loadOrganizations({ source: 'fhir' });
          loadDashboard();
        }
      );
    } catch (err) {
      showToast(err.message, 'err', { title: 'Sync failed' });
    } finally {
      resyncOrg.disabled = false;
    }
    return;
  }

  const resyncReferralBtn = e.target.closest('#referralSyncRetryBtn');
  if (resyncReferralBtn) {
    const referralId = resyncReferralBtn.dataset.referralId;
    if (!referralId) return;
    await retryReferralSync(referralId, resyncReferralBtn);
    return;
  }

  const resyncPrac = e.target.closest('[data-resync-prac]');
  if (resyncPrac) {
    resyncPrac.disabled = true;
    try {
      await withProgress(
        {
          title: 'Syncing practitioner',
          message: 'Pushing local clinician record to FHIR.',
          steps: ['Prepare record', 'Sync to FHIR server'],
        },
        async ({ setProgressStep, completeProgressModal }) => {
          setProgressStep(0, 'done');
          setProgressStep(1, 'active');
          const res = await fetch(`/api/practitioners/${resyncPrac.dataset.resyncPrac}/sync`, {
            method: 'POST',
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Sync failed');
          setProgressStep(1, 'done');
          completeProgressModal(true);
          showToast(`Synced FHIR ID ${data.practitioner.fhirId}`, 'ok', { title: 'Sync complete' });
          loadPractitioners({ source: 'fhir' });
          loadDashboard();
        }
      );
    } catch (err) {
      showToast(err.message, 'err', { title: 'Sync failed' });
    } finally {
      resyncPrac.disabled = false;
    }
    return;
  }

  const resync = e.target.closest('[data-resync]');
  if (resync) {
    resync.disabled = true;
    try {
      await withProgress(
        {
          title: 'Syncing patient',
          message: 'Pushing local patient record to FHIR.',
          steps: ['Prepare record', 'Sync to FHIR server'],
        },
        async ({ setProgressStep, completeProgressModal }) => {
          setProgressStep(0, 'done');
          setProgressStep(1, 'active');
          const res = await fetch(`/api/patients/${resync.dataset.resync}/sync`, { method: 'POST' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Sync failed');
          setProgressStep(1, 'done');
          completeProgressModal(true);
          showToast(`Synced FHIR ID ${data.patient.fhirId}`, 'ok', { title: 'Sync complete' });
          loadPatients();
          loadDashboard();
        }
      );
    } catch (err) {
      showToast(err.message, 'err', { title: 'Sync failed' });
    } finally {
      resync.disabled = false;
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('.action-menu.open')) {
      closeAllActionMenus();
      return;
    }
    if (state.progressAbort && !$('#progressModal')?.hidden && !$('#progressActions')?.hidden) {
      $('#progressCancelBtn')?.click();
      return;
    }
    if (!$('#recordViewModal')?.hidden) {
      closeRecordModal();
      return;
    }
    if (!$('#referralSyncModal')?.hidden) {
      closeReferralSyncModal();
      return;
    }
    if (!$('#fhirBundlePreviewModal')?.hidden) {
      closeFhirBundlePreviewModal();
      return;
    }
    if (!$('#practitionerQuickModal')?.hidden) {
      closePractitionerQuickModal();
      return;
    }
    if (!$('#practitionerRoleQuickModal')?.hidden) {
      closePractitionerRoleQuickModal();
    }
  }
});

window.addEventListener('scroll', () => closeAllActionMenus(), true);
window.addEventListener('resize', () => closeAllActionMenus());

$('#patientForm').addEventListener('submit', savePatient);
$('#organizationForm')?.addEventListener('submit', saveOrganization);
$('#practitionerForm')?.addEventListener('submit', savePractitioner);
$('#practitionerQuickForm')?.addEventListener('submit', savePractitioner);
$('#practitionerRoleForm')?.addEventListener('submit', savePractitionerRole);
$('#practitionerRoleQuickForm')?.addEventListener('submit', savePractitionerRole);
$('#btnOpenPractitionerModal')?.addEventListener('click', () => openPractitionerQuickModal('create'));
$('#btnOpenPractitionerRoleModal')?.addEventListener('click', () =>
  openPractitionerRoleQuickModal('create')
);
$('#practitionerQuickRoleSelect')?.addEventListener('change', () => {
  syncRoleSpecialtyHidden($('#practitionerQuickForm'));
});
$('#practitionerFormRoleSelect')?.addEventListener('change', () => {
  syncRoleSpecialtyHidden($('#practitionerForm'));
});
$('#rolePractitionerSelect')?.addEventListener('change', syncRoleQuickHiddenFields);
$('#roleOrganizationSelect')?.addEventListener('change', syncRoleQuickHiddenFields);
$('#roleSpecialtySelect')?.addEventListener('change', () => {
  syncRoleSpecialtyHidden($('#practitionerRoleQuickForm'));
});
$('#roleSpecialtySelectLegacy')?.addEventListener('change', () => {
  syncRoleSpecialtyHidden($('#practitionerRoleForm'));
});
$('#rolePractitionerSelectLegacy')?.addEventListener('change', syncRoleFormHiddenFields);
$('#roleOrganizationSelectLegacy')?.addEventListener('change', syncRoleFormHiddenFields);
$('#roleQuickActiveToggle')?.addEventListener('change', syncRoleQuickActiveHidden);
$('#referralForm')?.addEventListener('submit', saveReferral);
$('#previewReferralBundleBtn')?.addEventListener('click', () => previewReferralBundle());
$('#fhirBundlePreviewRefreshBtn')?.addEventListener('click', () => previewReferralBundle());
$('#fhirBundlePreviewSubmitBtn')?.addEventListener('click', () => {
  const form = $('#referralForm');
  if (!form) return;
  form.requestSubmit();
});
$('#transferReferralForm')?.addEventListener('submit', submitTransferReferral);

function onTransferFacilityChanged() {
  fillTransferPractitionerRoles($('#transferReceivingOrgId')?.value || '');
}

if (window.jQuery) {
  jQuery(document)
    .off('change.transferFacility select2:select.transferFacility')
    .on(
      'change.transferFacility select2:select.transferFacility',
      '#transferReceivingOrgId',
      onTransferFacilityChanged
    );
} else {
  $('#transferReceivingOrgId')?.addEventListener('change', onTransferFacilityChanged);
}

$('#referralPatientPickBtn')?.addEventListener('click', () => openPatientPickerModal());
$('#referralPatientChangeBtn')?.addEventListener('click', () => openPatientPickerModal());
$('#patientPickerSelectBtn')?.addEventListener('click', () => confirmPatientPickerSelection());
$('#patientPickerSearchForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  renderPatientPickerRows(filterReferralPatients($('#patientPickerSearch')?.value || ''));
});
$('#patientPickerBody')?.addEventListener('change', (e) => {
  if (!e.target.matches('input[name="patientPickerChoice"]')) return;
  const selectBtn = $('#patientPickerSelectBtn');
  if (selectBtn) selectBtn.disabled = false;
});
$('#patientPickerBody')?.addEventListener('dblclick', (e) => {
  const row = e.target.closest('.patient-picker-row');
  if (!row) return;
  const radio = row.querySelector('input[name="patientPickerChoice"]');
  if (radio) {
    radio.checked = true;
    const selectBtn = $('#patientPickerSelectBtn');
    if (selectBtn) selectBtn.disabled = false;
    confirmPatientPickerSelection();
  }
});
$('#patientPickerBody')?.addEventListener('click', (e) => {
  const row = e.target.closest('.patient-picker-row');
  if (!row || e.target.matches('input')) return;
  const radio = row.querySelector('input[name="patientPickerChoice"]');
  if (radio) {
    radio.checked = true;
    const selectBtn = $('#patientPickerSelectBtn');
    if (selectBtn) selectBtn.disabled = false;
  }
});

// Select2 triggers jQuery change, which native addEventListener often misses.
if (window.jQuery) {
  jQuery(document)
    .off('change.referralFacility select2:select.referralFacility')
    .on(
      'change.referralFacility select2:select.referralFacility',
      '#referralSendingOrgId, #referralReceivingOrgId',
      onReferralFacilityChanged
    );
} else {
  $('#referralSendingOrgId')?.addEventListener('change', onReferralFacilityChanged);
  $('#referralReceivingOrgId')?.addEventListener('change', onReferralFacilityChanged);
}

$('#sentSearchForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  loadSentReferrals({ q: $('#sentSearch')?.value?.trim() || '' });
});

$('#sentSearchClear')?.addEventListener('click', () => {
  if ($('#sentSearch')) $('#sentSearch').value = '';
  loadSentReferrals({ q: '' });
});

$('#inboxSearchForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const q = $('#inboxSearch')?.value?.trim() || '';
  loadInboxReferrals({
    q,
    status: $('#inboxStatusFilter')?.value || 'all',
    receivingOrgFhirId: $('#inboxReceivingFacilityFilter')?.value || '',
    page: 1,
    force: true,
  });
});

$('#inboxSearchClear')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if ($('#inboxSearch')) $('#inboxSearch').value = '';
  if ($('#inboxStatusFilter')) {
    $('#inboxStatusFilter').value = 'all';
    syncSearchableSelect($('#inboxStatusFilter'));
  }
  if ($('#inboxReceivingFacilityFilter')) {
    $('#inboxReceivingFacilityFilter').value = '';
    syncSearchableSelect($('#inboxReceivingFacilityFilter'));
  }
  state.inbox.q = '';
  state.inbox.status = 'all';
  state.inbox.receivingOrgFhirId = '';
  state.inbox.page = 1;
  loadInboxReferrals({
    q: '',
    status: 'all',
    receivingOrgFhirId: '',
    page: 1,
  });
});

$('#inboxStatusFilter')?.addEventListener('change', () => {
  loadInboxReferrals({ status: $('#inboxStatusFilter').value });
});

$('#inboxReceivingFacilityFilter')?.addEventListener('change', () => {
  if (state.inbox.suppressFacilityChange) return;
  loadInboxReferrals({
    receivingOrgFhirId: $('#inboxReceivingFacilityFilter').value,
    force: true,
  });
});

if (window.jQuery) {
  jQuery(document)
    .off('change.inboxFacility select2:select.inboxFacility')
    .on(
      'change.inboxFacility select2:select.inboxFacility',
      '#inboxReceivingFacilityFilter',
      () => {
        if (state.inbox.suppressFacilityChange) return;
        loadInboxReferrals({
          receivingOrgFhirId: jQuery('#inboxReceivingFacilityFilter').val() || '',
          force: true,
        });
      }
    );
}

$('#btnRefreshInboxLocal')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  loadInboxReferrals({ force: true, page: state.inbox.page || 1 });
});

$('#btnRefreshSent')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  loadSentReferrals();
});

$('#inboxPrev')?.addEventListener('click', () => {
  if (state.inbox.page > 1) {
    loadInboxReferrals({ page: state.inbox.page - 1 });
  }
});

$('#inboxNext')?.addEventListener('click', () => {
  if (state.inbox.page < state.inbox.totalPages) {
    loadInboxReferrals({ page: state.inbox.page + 1 });
  }
});

$('#progressCancelBtn')?.addEventListener('click', () => {
  const controller = state.progressAbort;
  if (!controller || controller.signal.aborted) return;
  const btn = $('#progressCancelBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Cancelling...';
  }
  const message = $('#progressMessage');
  if (message) message.textContent = 'Cancelling...';
  controller.abort();
});

$('#orgSearchForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  state.organizations.page = 1;
  loadOrganizations();
});

$('#orgSearchClear')?.addEventListener('click', () => {
  const input = $('#orgSearch');
  if (input) input.value = '';
  state.organizations.page = 1;
  loadOrganizations({ q: '' });
});

$('#pracSearchForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  state.practitioners.page = 1;
  loadPractitioners();
});

$('#pracSearchClear')?.addEventListener('click', () => {
  const input = $('#pracSearch');
  if (input) input.value = '';
  state.practitioners.page = 1;
  loadPractitioners({ q: '' });
});

$('#organizationsPrev')?.addEventListener('click', () => {
  if (state.organizations.page > 1) {
    state.organizations.page -= 1;
    loadOrganizations();
  }
});

$('#organizationsNext')?.addEventListener('click', () => {
  if (state.organizations.page < state.organizations.totalPages) {
    state.organizations.page += 1;
    loadOrganizations();
  }
});

$('#practitionersPrev')?.addEventListener('click', () => {
  if (state.practitioners.page > 1) {
    state.practitioners.page -= 1;
    loadPractitioners();
  }
});

$('#practitionersNext')?.addEventListener('click', () => {
  if (state.practitioners.page < state.practitioners.totalPages) {
    state.practitioners.page += 1;
    loadPractitioners();
  }
});

$('#patientSearchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  state.patients.q = $('#patientSearchInput').value.trim();
  state.patients.page = 1;
  loadPatients();
});

$('#patientSearchClear').addEventListener('click', () => {
  $('#patientSearchInput').value = '';
  state.patients.q = '';
  state.patients.page = 1;
  loadPatients();
});

$('#patientsPrev').addEventListener('click', () => {
  if (state.patients.page > 1) {
    state.patients.page -= 1;
    loadPatients();
  }
});

$('#patientsNext').addEventListener('click', () => {
  if (state.patients.page < state.patients.totalPages) {
    state.patients.page += 1;
    loadPatients();
  }
});

$('#welcomeDate').textContent = new Date().toLocaleString(undefined, {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

syncActiveFacilityUi();
setView(getInitialView());
initRealtime();
initAllSearchableSelects();
setInterval(loadHealth, 30000);

window.addEventListener('hashchange', () => {
  const view = (location.hash || '').replace(/^#/, '').trim();
  if (view && document.getElementById(`view-${view}`)) {
    setView(view);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (currentViewId() !== 'inbox') return;
  loadInboxReferrals({ quiet: true, page: state.inbox.page || 1 });
});
