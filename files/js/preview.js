/* ==========================================================================
   preview.js — Turns a form configuration into a real, working form.

   Responsibilities
   - buildField(): create the HTML for ONE field (used by the canvas too)
   - render():     create the whole form, validate it and show a success state
   - validateField(): the validation rules, one function per rule type

   Also shares two tiny helpers with the other files: el() and icon().
   ========================================================================== */
const FormPreview = (function () {
  'use strict';

  /* ======================================================================
     1. SMALL HELPERS
     ====================================================================== */

  // Inline SVG icons (24x24 grid). Drawn with currentColor so CSS can recolour them.
  const ICON_PATHS = {
    text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    number: '<path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16"/>',
    textarea: '<path d="M4 6h16M4 11h16M4 16h10"/>',
    dropdown: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="m9 11 3 3 3-3"/>',
    radio: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>',
    checkbox: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    date: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    file: '<path d="M12 16V5m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
    grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></g>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>',
    save: '<path d="M5 4h11l3 3v13H5V4Z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>'
  };

  function icon(name, size) {
    const px = size || 18;
    return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + (ICON_PATHS[name] || '') + '</svg>';
  }

  /**
   * el(tag, attributes, children) — a tiny helper for creating DOM elements.
   *   attributes: { class, text, html, onclick: fn, ...any HTML attribute }
   *   children:   a node, a string, or an array of them (null/false are skipped)
   * `html` is only ever used with our own trusted icon strings.
   * User-provided text always goes through `text` (textContent), so it is safe.
   */
  function el(tag, attributes, children) {
    const node = document.createElement(tag);

    Object.keys(attributes || {}).forEach(function (name) {
      const value = attributes[name];
      if (value === false || value === null || value === undefined) return;

      if (name === 'class') node.className = value;
      else if (name === 'text') node.textContent = value;
      else if (name === 'html') node.innerHTML = value;
      else if (name.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(name.slice(2), value);
      else node.setAttribute(name, value === true ? '' : value);
    });

    [].concat(children === undefined ? [] : children).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });

    return node;
  }

  // True when a validation setting has been filled in (0 counts as filled in).
  function isSet(value) {
    return value !== '' && value !== null && value !== undefined && !isNaN(Number(value));
  }

  // Options without blank entries, as trimmed strings.
  function cleanOptions(field) {
    return (field.options || []).map(function (option) {
      return String(option).trim();
    }).filter(Boolean);
  }

  // Build a RegExp from user text, or return null if it is not valid.
  function safeRegExp(source) {
    try { return new RegExp(source); } catch (error) { return null; }
  }

  function isValidPattern(source) {
    return !source || safeRegExp(source) !== null;
  }

  function formatDate(isoDate) {
    const parts = String(isoDate).split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return isoDate;
    return new Date(parts[0], parts[1] - 1, parts[2])
      .toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // File type presets offered to the form author.
  const ACCEPT_TYPES = {
    any:      { label: 'Any file type',                    attr: '',                       exts: [] },
    image:    { label: 'Images (JPG, PNG, GIF, WebP)',     attr: 'image/*',                exts: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
    pdf:      { label: 'PDF documents',                    attr: '.pdf,application/pdf',   exts: ['pdf'] },
    document: { label: 'Documents (PDF, Word, TXT)',       attr: '.pdf,.doc,.docx,.txt',   exts: ['pdf', 'doc', 'docx', 'txt'] }
  };

  function fileMatchesAccept(file, acceptKey) {
    const rule = ACCEPT_TYPES[acceptKey] || ACCEPT_TYPES.any;
    if (!rule.exts.length) return true;
    if (acceptKey === 'image' && file.type.indexOf('image/') === 0) return true;
    const extension = (file.name.split('.').pop() || '').toLowerCase();
    return rule.exts.indexOf(extension) !== -1;
  }

  /* ======================================================================
     2. BUILDING A SINGLE FIELD
     ====================================================================== */

  /**
   * buildField(field, options)
   *   options.prefix: makes element ids unique when the same field is drawn in
   *                   more than one place (canvas = "cv", preview = "pv").
   *   options.inert:  true = draw it but make it non-interactive (canvas cards).
   */
  function buildField(field, options) {
    options = options || {};
    const prefix = options.prefix || 'pv';
    const baseId = prefix + '-' + field.id;
    const isGroup = field.type === 'radio' || field.type === 'checkbox';
    const helpId = baseId + '-help';
    const errorId = baseId + '-err';
    const describedBy = (field.helpText ? helpId + ' ' : '') + errorId;
    const validation = field.validation || {};

    // Radio/checkbox groups use <fieldset>/<legend>; everything else <div>/<label>.
    const group = el(isGroup ? 'fieldset' : 'div', {
      class: 'fw-field',
      'data-field-id': field.id,
      'data-type': field.type
    });

    group.appendChild(el(isGroup ? 'legend' : 'label', {
      class: 'fw-label',
      for: isGroup ? false : baseId
    }, [
      field.label || 'Untitled field',
      field.required ? el('span', { class: 'fw-req', 'aria-hidden': 'true', text: ' *' }) : null,
      field.required ? el('span', { class: 'sr-only', text: ' (required)' }) : null
    ]));

    const control = buildControl(field, baseId, describedBy);
    if (options.inert) control.setAttribute('inert', '');
    group.appendChild(control);

    if (field.helpText) {
      group.appendChild(el('p', { class: 'fw-help', id: helpId, text: field.helpText }));
    }

    // Character counter for long text with a maximum length.
    if (field.type === 'textarea' && isSet(validation.maxLength)) {
      const counter = el('p', { class: 'fw-count', 'aria-hidden': 'true', text: '0 / ' + validation.maxLength });
      control.addEventListener('input', function () {
        counter.textContent = control.value.length + ' / ' + validation.maxLength;
        counter.classList.toggle('is-over', control.value.length > Number(validation.maxLength));
      });
      group.appendChild(counter);
    }

    group.appendChild(el('p', { class: 'fw-error', id: errorId, role: 'alert', hidden: true }));
    return group;
  }

  // Creates the actual input / select / textarea / choice list for a field.
  function buildControl(field, id, describedBy) {
    const v = field.validation || {};

    switch (field.type) {
      case 'text':
      case 'email':
      case 'number':
      case 'date': {
        return el('input', {
          id: id,
          name: id,
          type: field.type,
          class: 'fw-input',
          placeholder: field.type === 'date' ? false : field.placeholder,
          autocomplete: field.type === 'email' ? 'email' : 'off',
          min: field.type === 'number' && isSet(v.min) ? v.min : (field.type === 'date' && v.min ? v.min : false),
          max: field.type === 'number' && isSet(v.max) ? v.max : (field.type === 'date' && v.max ? v.max : false),
          step: field.type === 'number' ? (v.integerOnly ? '1' : 'any') : false,
          'aria-describedby': describedBy
        });
      }

      case 'textarea':
        return el('textarea', {
          id: id,
          name: id,
          class: 'fw-input fw-textarea',
          rows: isSet(v.rows) && Number(v.rows) > 0 ? v.rows : 4,
          placeholder: field.placeholder,
          'aria-describedby': describedBy
        });

      case 'dropdown': {
        const select = el('select', { id: id, name: id, class: 'fw-input fw-select', 'aria-describedby': describedBy });
        select.appendChild(el('option', { value: '', text: field.placeholder || 'Select an option' }));
        cleanOptions(field).forEach(function (option) {
          select.appendChild(el('option', { value: option, text: option }));
        });
        return select;
      }

      case 'radio':
      case 'checkbox':
        return buildChoices(field, id, describedBy);

      case 'file':
        return buildFileDrop(field, id, describedBy);

      default:
        return el('div');
    }
  }

  // A list of radio buttons or checkboxes.
  function buildChoices(field, baseId, describedBy) {
    const kind = field.type;
    const wrapper = el('div', { class: 'fw-choices', role: kind === 'radio' ? 'radiogroup' : 'group' });

    cleanOptions(field).forEach(function (option, index) {
      const inputId = baseId + '-o' + index;
      const input = el('input', {
        type: kind,
        id: inputId,
        name: kind === 'radio' ? baseId : baseId + '[]',
        value: option,
        'aria-describedby': index === 0 ? describedBy : false
      });
      wrapper.appendChild(el('label', { class: 'fw-choice', for: inputId }, [input, el('span', { text: option })]));
    });

    return wrapper;
  }

  function describeFileRules(v) {
    const parts = [(ACCEPT_TYPES[v.accept] || ACCEPT_TYPES.any).label];
    if (isSet(v.maxSizeMB) && Number(v.maxSizeMB) > 0) parts.push('up to ' + v.maxSizeMB + ' MB each');
    return parts.join(', ');
  }

  // A friendly drop zone wrapped around a real <input type="file">.
  function buildFileDrop(field, id, describedBy) {
    const v = field.validation || {};
    const names = el('span', { class: 'fw-file-names' });
    const input = el('input', {
      type: 'file',
      id: id,
      name: id,
      class: 'fw-file-input',
      accept: (ACCEPT_TYPES[v.accept] || ACCEPT_TYPES.any).attr || false,
      multiple: v.multiple ? true : false,
      'aria-describedby': describedBy
    });

    const zone = el('label', { class: 'fw-file' }, [
      input,
      el('span', { class: 'fw-file-icon', html: icon('file', 22) }),
      el('span', { class: 'fw-file-title', text: v.multiple ? 'Choose files or drop them here' : 'Choose a file or drop it here' }),
      el('span', { class: 'fw-file-sub', text: describeFileRules(v) }),
      names
    ]);

    input.addEventListener('change', function () {
      const list = Array.from(input.files).map(function (file) { return file.name; });
      names.textContent = list.join(', ');
      zone.classList.toggle('has-files', list.length > 0);
    });
    ['dragenter', 'dragover'].forEach(function (type) {
      zone.addEventListener(type, function () { zone.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      zone.addEventListener(type, function () { zone.classList.remove('is-over'); });
    });

    return zone;
  }

  /* ======================================================================
     3. READING VALUES AND VALIDATING
     ====================================================================== */

  // Read the current value out of a rendered field.
  function getValue(field, group) {
    switch (field.type) {
      case 'radio': {
        const checked = group.querySelector('input:checked');
        return checked ? checked.value : '';
      }
      case 'checkbox':
        return Array.from(group.querySelectorAll('input:checked')).map(function (input) { return input.value; });
      case 'file':
        return Array.from(group.querySelector('input[type="file"]').files);
      case 'number': {
        const input = group.querySelector('input');
        return input.validity.badInput ? 'NaN' : input.value;   // typed text the browser rejected
      }
      default:
        return group.querySelector('input, select, textarea').value;
    }
  }

  function requiredMessage(field) {
    if (field.type === 'checkbox') return 'Select at least one option.';
    if (field.type === 'radio' || field.type === 'dropdown') return 'Choose an option.';
    if (field.type === 'file') return 'Attach a file.';
    return 'This field is required.';
  }

  /**
   * validateField(field, value) -> an error message, or '' when the value is fine.
   * Optional fields that are left empty are always fine.
   */
  function validateField(field, value) {
    const v = field.validation || {};
    const isEmpty = Array.isArray(value) ? value.length === 0 : String(value).trim() === '';

    if (isEmpty) return field.required ? requiredMessage(field) : '';

    switch (field.type) {
      case 'text':
      case 'textarea': {
        const text = String(value).trim();
        if (isSet(v.minLength) && text.length < Number(v.minLength)) {
          return 'Use at least ' + v.minLength + ' characters (you have ' + text.length + ').';
        }
        if (isSet(v.maxLength) && text.length > Number(v.maxLength)) {
          return 'Use ' + v.maxLength + ' characters or fewer (you have ' + text.length + ').';
        }
        if (field.type === 'text' && v.pattern) {
          const pattern = safeRegExp(v.pattern);
          if (pattern && !pattern.test(text)) return v.patternMessage || 'This doesn’t match the expected format.';
        }
        return '';
      }

      case 'email': {
        const email = String(value).trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address, like name@example.com.';
        if (v.allowedDomain) {
          const wanted = String(v.allowedDomain).trim().replace(/^@/, '').toLowerCase();
          const actual = email.split('@')[1].toLowerCase();
          if (wanted && actual !== wanted) return 'Use an email address ending in @' + wanted + '.';
        }
        return '';
      }

      case 'number': {
        const number = Number(value);
        if (value === 'NaN' || !isFinite(number)) return 'Enter a valid number.';
        if (v.integerOnly && !Number.isInteger(number)) return 'Enter a whole number.';
        if (isSet(v.min) && number < Number(v.min)) return 'Enter a number that is ' + v.min + ' or more.';
        if (isSet(v.max) && number > Number(v.max)) return 'Enter a number that is ' + v.max + ' or less.';
        return '';
      }

      case 'date': {
        // ISO dates (YYYY-MM-DD) compare correctly as plain strings.
        if (v.min && value < v.min) return 'Choose a date on or after ' + formatDate(v.min) + '.';
        if (v.max && value > v.max) return 'Choose a date on or before ' + formatDate(v.max) + '.';
        return '';
      }

      case 'checkbox': {
        if (isSet(v.minSelected) && value.length < Number(v.minSelected)) {
          return 'Select at least ' + v.minSelected + ' option' + (Number(v.minSelected) === 1 ? '' : 's') + '.';
        }
        if (isSet(v.maxSelected) && value.length > Number(v.maxSelected)) {
          return 'Select no more than ' + v.maxSelected + ' option' + (Number(v.maxSelected) === 1 ? '' : 's') + '.';
        }
        return '';
      }

      case 'file': {
        const limit = isSet(v.maxSizeMB) ? Number(v.maxSizeMB) * 1024 * 1024 : 0;
        for (let i = 0; i < value.length; i++) {
          const file = value[i];
          if (!fileMatchesAccept(file, v.accept)) {
            return '“' + file.name + '” isn’t an accepted file type. Use: ' + (ACCEPT_TYPES[v.accept] || ACCEPT_TYPES.any).label + '.';
          }
          if (limit > 0 && file.size > limit) {
            return '“' + file.name + '” is ' + formatBytes(file.size) + '. The limit is ' + v.maxSizeMB + ' MB.';
          }
        }
        return '';
      }

      default:
        return '';
    }
  }

  // Show (or clear) an error under a field.
  function showError(group, message) {
    const errorEl = group.querySelector('.fw-error');
    errorEl.textContent = message;
    errorEl.hidden = !message;
    group.classList.toggle('has-error', Boolean(message));
    group.querySelectorAll('input, select, textarea').forEach(function (control) {
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    });
  }

  // Turn a value into readable text for the "your answers" summary.
  function describeValue(value) {
    if (Array.isArray(value)) {
      if (!value.length) return '—';
      return value.map(function (item) { return item && item.name ? item.name : String(item); }).join(', ');
    }
    return String(value).trim() === '' ? '—' : String(value);
  }

  // Validate every field. Returns what the submit handler needs to know.
  function validateAll(form, formEl) {
    let firstInvalid = null;
    let invalidCount = 0;
    const answers = [];

    form.fields.forEach(function (field) {
      const group = formEl.querySelector('[data-field-id="' + CSS.escape(field.id) + '"]');
      if (!group) return;

      const value = getValue(field, group);
      const message = validateField(field, value);
      showError(group, message);

      if (message) {
        invalidCount++;
        if (!firstInvalid) firstInvalid = group;
      }
      answers.push({ label: field.label || 'Untitled field', value: describeValue(value) });
    });

    return { firstInvalid: firstInvalid, invalidCount: invalidCount, answers: answers };
  }

  // Validate a single field as the visitor interacts with it.
  function wireLiveValidation(group, field) {
    function check() { showError(group, validateField(field, getValue(field, group))); }

    // Leaving the field = "touched". After that, check on every change.
    group.addEventListener('focusout', function (event) {
      if (group.contains(event.relatedTarget)) return;   // moving inside the same group
      group.dataset.touched = '1';
      check();
    });
    ['input', 'change'].forEach(function (type) {
      group.addEventListener(type, function () {
        if (type === 'change' && field.type === 'file') group.dataset.touched = '1';
        if (group.dataset.touched) check();
      });
    });
  }

  /* ======================================================================
     4. RENDERING THE WHOLE FORM
     ====================================================================== */

  /**
   * render(form, mount, options)
   *   options.prefix      id prefix (default "pv")
   *   options.selectedId  highlight this field
   *   options.onSelect    called with a field id when a field is clicked
   *   options.onInvalid   called with the number of invalid fields
   *   options.onSuccess   called after a valid submit
   */
  function render(form, mount, options) {
    options = options || {};
    mount.replaceChildren();

    const formEl = el('form', { class: 'fw-form' + (options.onSelect ? ' fw-form--selectable' : ''), novalidate: true });
    formEl.appendChild(el('h2', { class: 'fw-title', text: form.title || 'Untitled form' }));
    if (form.description) formEl.appendChild(el('p', { class: 'fw-description', text: form.description }));

    const fieldsEl = el('div', { class: 'fw-fields' });
    form.fields.forEach(function (field) {
      const group = buildField(field, { prefix: options.prefix || 'pv' });
      wireLiveValidation(group, field);
      if (options.onSelect) group.addEventListener('click', function () { options.onSelect(field.id); });
      fieldsEl.appendChild(group);
    });
    if (!form.fields.length) {
      fieldsEl.appendChild(el('p', { class: 'fw-empty', text: 'This form has no fields yet. Add some from the left panel.' }));
    }
    formEl.appendChild(fieldsEl);

    formEl.appendChild(el('div', { class: 'fw-actions fw-actions--' + (form.submitAlign || 'left') }, [
      el('button', { type: 'submit', class: 'fw-submit', text: form.submitText || 'Submit' })
    ]));

    formEl.addEventListener('submit', function (event) {
      event.preventDefault();
      const result = validateAll(form, formEl);

      if (result.firstInvalid) {
        const control = result.firstInvalid.querySelector('input, select, textarea');
        result.firstInvalid.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (control) control.focus({ preventScroll: true });
        if (options.onInvalid) options.onInvalid(result.invalidCount);
        return;
      }

      showSuccess(form, mount, options, result.answers);
      if (options.onSuccess) options.onSuccess();
    });

    mount.appendChild(formEl);
    if (options.selectedId) setSelected(mount, options.selectedId);
  }

  // The "thank you" screen with a readable summary of what was entered.
  function showSuccess(form, mount, options, answers) {
    const summary = el('dl', { class: 'fw-answers' });
    answers.forEach(function (answer) {
      summary.appendChild(el('dt', { text: answer.label }));
      summary.appendChild(el('dd', { text: answer.value }));
    });

    mount.replaceChildren(el('div', { class: 'fw-success', role: 'status' }, [
      el('span', { class: 'fw-success-icon', html: icon('check', 26) }),
      el('h2', { class: 'fw-title', text: form.successMessage || 'Thanks! Your response has been recorded.' }),
      answers.length ? summary : null,
      el('p', { class: 'fw-note', text: 'This is a preview, so nothing was sent anywhere.' }),
      el('button', { type: 'button', class: 'fw-secondary', text: 'Fill it out again', onclick: function () { render(form, mount, options); } })
    ]));
  }

  // Highlight one field inside a rendered preview (without re-rendering it).
  function setSelected(mount, fieldId) {
    mount.querySelectorAll('.fw-field').forEach(function (group) {
      group.classList.toggle('is-selected', group.dataset.fieldId === fieldId);
    });
  }

  return {
    el: el,
    icon: icon,
    isSet: isSet,
    isValidPattern: isValidPattern,
    ACCEPT_TYPES: ACCEPT_TYPES,
    buildField: buildField,
    validateField: validateField,
    render: render,
    setSelected: setSelected
  };
})();
