/* global jQuery */

const PsgcSelect = (() => {
  const LEVELS = ['region', 'province', 'city', 'barangay'];
  const DEFAULT_REGION = {
    id: '1200000000',
    text: 'Region XII (SOCCSKSARGEN)',
    code: '1200000000',
    display: 'Region XII (SOCCSKSARGEN)',
  };

  function levelSelect($root, level) {
    return $root.find(`.psgc-select[data-psgc-level="${level}"]`);
  }

  function syncHidden($root, level, option) {
    const code = option?.code || option?.id || '';
    const display = option?.display || '';
    $root.find(`[name="${level}Code"]`).val(code);
    $root.find(`[name="${level}Display"]`).val(display);
  }

  function clearFrom($root, startLevel) {
    const startIdx = LEVELS.indexOf(startLevel);
    LEVELS.slice(startIdx).forEach((level) => {
      const $el = levelSelect($root, level);
      $el.empty().val(null).trigger('change.select2');
      syncHidden($root, level, null);
      if (level !== 'region') $el.prop('disabled', true);
    });
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function loadChildren(parentCode) {
    if (!parentCode) return [];
    const data = await fetchJson(
      `/api/psgc/children?parent=${encodeURIComponent(parentCode)}`
    );
    return data.results || [];
  }

  async function childrenAreLeaves(options) {
    if (!options.length) return true;
    const sample = options[0];
    const data = await fetchJson(
      `/api/psgc/lookup?code=${encodeURIComponent(sample.code || sample.id)}`
    );
    return !(data.children && data.children.length);
  }

  function labelFromOption(opt, code) {
    if (opt.display) return opt.display;
    const text = String(opt.text || '');
    const stripped = text.match(/^\d+\s*-\s*(.+)$/);
    if (stripped) return stripped[1];
    return text || code;
  }

  function normalizeOption(opt) {
    if (!opt) return null;
    const code = opt.code || opt.id;
    const label = labelFromOption(opt, code);
    return {
      id: code,
      code,
      display: label,
      text: label,
    };
  }

  function setOptions($el, options, { enable = true } = {}) {
    $el.empty();
    (options || []).forEach((raw) => {
      const opt = normalizeOption(raw);
      const el = new Option(opt.text, opt.id, false, false);
      jQuery(el).data('psgc', opt);
      $el.append(el);
    });
    $el.prop('disabled', !enable);
    $el.val(null).trigger('change.select2');
  }

  function selectedOption($el) {
    const data = $el.select2('data');
    if (data && data[0]) {
      const item = data[0];
      const fromData = item.psgc || item;
      if (fromData.code || fromData.id) {
        return normalizeOption({
          id: fromData.id || fromData.code,
          code: fromData.code || fromData.id,
          display: fromData.display || '',
          text: item.text,
        });
      }
    }
    const val = $el.val();
    if (!val) return null;
    const $opt = $el.find('option:selected');
    const stored = $opt.data('psgc');
    if (stored) return normalizeOption(stored);
    return normalizeOption({
      id: val,
      code: val,
      display: '',
      text: $opt.text(),
    });
  }

  function ensureOption($el, raw) {
    const opt = normalizeOption(raw);
    if (!opt?.id) return;
    if (!$el.find(`option[value="${CSS.escape(opt.id)}"]`).length) {
      const el = new Option(opt.text, opt.id, true, true);
      jQuery(el).data('psgc', opt);
      $el.append(el);
    }
    $el.prop('disabled', false);
    $el.val(opt.id).trigger('change.select2');
  }

  async function onRegionChange($root) {
    const region = selectedOption(levelSelect($root, 'region'));
    syncHidden($root, 'region', region);
    clearFrom($root, 'province');
    if (!region?.code) return;

    const children = await loadChildren(region.code);
    setOptions(levelSelect($root, 'province'), children, { enable: true });
  }

  async function onProvinceChange($root) {
    const province = selectedOption(levelSelect($root, 'province'));
    syncHidden($root, 'province', province);
    clearFrom($root, 'city');
    if (!province?.code) return;

    const children = await loadChildren(province.code);
    if (!children.length) return;

    const leaves = await childrenAreLeaves(children);
    const $city = levelSelect($root, 'city');
    if (leaves) {
      // HUC: barangays hang directly under province/HUC
      ensureOption($city, province);
      $city.prop('disabled', true);
      syncHidden($root, 'city', province);
      setOptions(levelSelect($root, 'barangay'), children, { enable: true });
    } else {
      setOptions($city, children, { enable: true });
    }
  }

  async function onCityChange($root) {
    const city = selectedOption(levelSelect($root, 'city'));
    syncHidden($root, 'city', city);

    const province = selectedOption(levelSelect($root, 'province'));
    if (city?.code && province?.code && city.code === province.code) {
      return;
    }

    const $barangay = levelSelect($root, 'barangay');
    $barangay.empty().val(null).trigger('change.select2');
    syncHidden($root, 'barangay', null);
    $barangay.prop('disabled', true);
    if (!city?.code) return;

    const children = await loadChildren(city.code);
    setOptions($barangay, children, { enable: true });
  }

  function onBarangayChange($root) {
    syncHidden($root, 'barangay', selectedOption(levelSelect($root, 'barangay')));
  }

  let regionsCache = null;

  async function loadAllRegions() {
    if (regionsCache) return regionsCache;
    const data = await fetchJson('/api/psgc/regions');
    regionsCache = (data.results || []).map((r) => {
      const opt = normalizeOption(r);
      return { ...opt, psgc: opt };
    });
    return regionsCache;
  }

  function initRegionSelect($el) {
    $el.select2({
      width: '100%',
      allowClear: true,
      placeholder: $el.data('placeholder') || 'Search region...',
      minimumInputLength: 0,
      ajax: {
        delay: 0,
        data(params) {
          return { q: params.term || '' };
        },
        transport(params, success, failure) {
          const term = String(params.data.q || '').trim().toLowerCase();
          loadAllRegions()
            .then((all) => {
              const results = term
                ? all.filter(
                    (r) =>
                      r.text.toLowerCase().includes(term) ||
                      String(r.id).includes(term)
                  )
                : all;
              success({ results });
            })
            .catch(failure);
        },
        processResults(data) {
          return { results: data.results || [] };
        },
      },
    });
  }

  function initChildSelect($el) {
    $el.select2({
      width: '100%',
      allowClear: true,
      placeholder: $el.data('placeholder') || 'Select...',
    });
    $el.prop('disabled', true);
  }

  function wireRoot($root) {
    if ($root.data('psgcReady')) return;
    $root.data('psgcReady', true);
    $root.data('psgcSilent', false);

    const $region = levelSelect($root, 'region');
    const $province = levelSelect($root, 'province');
    const $city = levelSelect($root, 'city');
    const $barangay = levelSelect($root, 'barangay');

    initRegionSelect($region);
    initChildSelect($province);
    initChildSelect($city);
    initChildSelect($barangay);

    $region.on('change', async () => {
      if ($root.data('psgcSilent')) return;
      try {
        await onRegionChange($root);
      } catch (err) {
        if (typeof showToast === 'function') showToast(err.message, 'err');
      }
    });
    $province.on('change', async () => {
      if ($root.data('psgcSilent')) return;
      try {
        await onProvinceChange($root);
      } catch (err) {
        if (typeof showToast === 'function') showToast(err.message, 'err');
      }
    });
    $city.on('change', async () => {
      if ($root.data('psgcSilent')) return;
      try {
        await onCityChange($root);
      } catch (err) {
        if (typeof showToast === 'function') showToast(err.message, 'err');
      }
    });
    $barangay.on('change', () => {
      if ($root.data('psgcSilent')) return;
      onBarangayChange($root);
    });
  }

  function initAll() {
    if (!window.jQuery || !jQuery.fn.select2) return;
    jQuery('.psgc-address').each(function initEach() {
      wireRoot(jQuery(this));
    });
  }

  async function setValues($root, values = {}) {
    wireRoot($root);
    $root.data('psgcSilent', true);
    try {
      const $region = levelSelect($root, 'region');
      clearFrom($root, 'province');
      $region.val(null).trigger('change.select2');
      syncHidden($root, 'region', null);

      if (!values.regionCode) return;

      ensureOption($region, {
        code: values.regionCode,
        display: values.regionDisplay || '',
      });
      syncHidden($root, 'region', {
        code: values.regionCode,
        display: values.regionDisplay || '',
      });

      const children = await loadChildren(values.regionCode);
      setOptions(levelSelect($root, 'province'), children, { enable: true });

      if (!values.provinceCode) return;
      ensureOption(levelSelect($root, 'province'), {
        code: values.provinceCode,
        display: values.provinceDisplay || '',
      });
      syncHidden($root, 'province', {
        code: values.provinceCode,
        display: values.provinceDisplay || '',
      });

      const provinceChildren = await loadChildren(values.provinceCode);
      const leaves = await childrenAreLeaves(provinceChildren);
      const $city = levelSelect($root, 'city');

      if (leaves) {
        ensureOption($city, {
          code: values.cityCode || values.provinceCode,
          display: values.cityDisplay || values.provinceDisplay || '',
        });
        $city.prop('disabled', true);
        syncHidden($root, 'city', {
          code: values.cityCode || values.provinceCode,
          display: values.cityDisplay || values.provinceDisplay || '',
        });
        setOptions(levelSelect($root, 'barangay'), provinceChildren, { enable: true });
      } else {
        setOptions($city, provinceChildren, { enable: true });
        if (values.cityCode) {
          ensureOption($city, {
            code: values.cityCode,
            display: values.cityDisplay || '',
          });
          syncHidden($root, 'city', {
            code: values.cityCode,
            display: values.cityDisplay || '',
          });
          const cityChildren = await loadChildren(values.cityCode);
          setOptions(levelSelect($root, 'barangay'), cityChildren, { enable: true });
        }
      }

      if (values.barangayCode) {
        ensureOption(levelSelect($root, 'barangay'), {
          code: values.barangayCode,
          display: values.barangayDisplay || '',
        });
        syncHidden($root, 'barangay', {
          code: values.barangayCode,
          display: values.barangayDisplay || '',
        });
      }
    } finally {
      $root.data('psgcSilent', false);
    }
  }

  function setFormValues(formSelector, values) {
    const $root = jQuery(formSelector).find('.psgc-address').first();
    if (!$root.length) return Promise.resolve();
    return setValues($root, values);
  }

  function resetForm(formSelector, defaults = {}) {
    return setFormValues(formSelector, defaults);
  }

  function setReadonly(formSelector, readonly) {
    const $root = jQuery(formSelector).find('.psgc-address').first();
    if (!$root.length) return;
    $root.find('.psgc-select').each(function disableEach() {
      jQuery(this).prop('disabled', readonly);
    });
  }

  return {
    initAll,
    setFormValues,
    resetForm,
    setReadonly,
    DEFAULT_REGION,
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  PsgcSelect.initAll();
});
