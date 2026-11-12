/* ==========================================================================
   builder.js — The form being edited: data, canvas, drag-and-drop, properties.

   Sections
     1. Field type registry   what kinds of fields exist and their defaults
     2. Form data helpers     create / clean up / sample forms
     3. State                 the current form and what is selected
     4. Editing operations    add, delete, duplicate, move, update
     5. Palette               the draggable list in the left sidebar
     6. Canvas                drawing the field cards
     7. Drag and drop         the native HTML5 Drag-and-Drop API
     8. Properties panel      editing the selected field / form settings
     9. Public API
   ========================================================================== */
const Builder = (function () {
  'use strict';

  const el = FormPreview.el;
  const icon = FormPreview.icon;

  /* ======================================================================
     1. FIELD TYPE REGISTRY
     ====================================================================== */

  const FIELD_TYPES = [
    { type: 'text',     name: 'Short text',      group: 'Text entry', hint: 'Names, titles, one-liners', label: 'Full name',            placeholder: 'Your full name' },
    { type: 'email',    name: 'Email',           group: 'Text entry', hint: 'Checks the address format', label: 'Email address',        placeholder: 'you@example.com' },
    { type: 'number',   name: 'Number',          group: 'Text entry', hint: 'Quantities, ages, prices',  label: 'Quantity',             placeholder: '0' },
    { type: 'textarea', name: 'Long text',       group: 'Text entry', hint: 'Messages and comments',     label: 'Your message',         placeholder: 'Write your message…' },
    { type: 'dropdown', name: 'Dropdown',        group: 'Choices',    hint: 'Pick one from a list',      label: 'Choose one',           placeholder: 'Select an option', hasOptions: true },
    { type: 'radio',    name: 'Single choice',   group: 'Choices',    hint: 'Radio buttons',             label: 'Pick one',             hasOptions: true },
    { type: 'checkbox', name: 'Multiple choice', group: 'Choices',    hint: 'Checkboxes',                label: 'Select all that apply', hasOptions: true },
    { type: 'date',     name: 'Date',            group: 'Date and files', hint: 'Calendar picker',       label: 'Date' },
    { type: 'file',     name: 'File upload',     group: 'Date and files', hint: 'Attachments with limits', label: 'Attachment' }
  ];

  // Quick lookup: TYPE_MAP['email'] -> the definition above.
  const TYPE_MAP = {};
  FIELD_TYPES.forEach(function (definition) { TYPE_MAP[definition.type] = definition; });

  // Which fields have a placeholder setting.
  const PLACEHOLDER_TYPES = ['text', 'email', 'number', 'textarea', 'dropdown'];

  // Validation settings each field type owns, with their starting values.
  // '' means "no limit / not set".
  const VALIDATION_DEFAULTS = {
    text:     { minLength: '', maxLength: '', pattern: '', patternMessage: '' },
    email:    { allowedDomain: '' },
    number:   { min: '', max: '', integerOnly: false },
    textarea: { rows: 4, minLength: '', maxLength: '' },
    dropdown: {},
    radio:    {},
    checkbox: { minSelected: '', maxSelected: '' },
    date:     { min: '', max: '' },
    file:     { accept: 'any', maxSizeMB: 5, multiple: false }
  };
  const NUMERIC_RULES = ['minLength', 'maxLength', 'min', 'max', 'rows', 'maxSizeMB', 'minSelected', 'maxSelected'];

  /* ======================================================================
     2. FORM DATA HELPERS
     ====================================================================== */

  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function createBlankForm() {
    return {
      id: uid('form'),
      title: 'Untitled form',
      description: '',
      submitText: 'Submit',
      submitAlign: 'left',
      successMessage: 'Thanks! Your response has been recorded.',
      fields: []
    };
  }

  // A brand-new field of the given type, filled with sensible defaults.
  function createField(type) {
    const definition = TYPE_MAP[type];
    return {
      id: uid('fld'),
      type: type,
      label: definition.label,
      placeholder: definition.placeholder || '',
      helpText: '',
      required: false,
      options: definition.hasOptions ? ['Option 1', 'Option 2', 'Option 3'] : [],
      validation: Object.assign({}, VALIDATION_DEFAULTS[type])
    };
  }

  /**
   * normalizeForm(raw) — accepts anything (imported file, old storage) and
   * returns a clean, safe form object, or null if it can't be a form.
   */
  function normalizeForm(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.fields)) return null;

    const form = createBlankForm();
    const text = function (value, fallback) { return typeof value === 'string' ? value : fallback; };

    form.id = raw.id && typeof raw.id === 'string' ? raw.id : form.id;
    form.title = text(raw.title, form.title);
    form.description = text(raw.description, '');
    form.submitText = text(raw.submitText, form.submitText) || 'Submit';
    form.submitAlign = ['left', 'center', 'right'].indexOf(raw.submitAlign) !== -1 ? raw.submitAlign : 'left';
    form.successMessage = text(raw.successMessage, form.successMessage);

    const usedIds = {};
    raw.fields.forEach(function (item) {
      if (!item || !TYPE_MAP[item.type]) return;          // skip unknown field types

      const field = createField(item.type);
      if (typeof item.id === 'string' && item.id && !usedIds[item.id]) field.id = item.id;
      usedIds[field.id] = true;

      field.label = text(item.label, field.label);
      field.placeholder = text(item.placeholder, field.placeholder);
      field.helpText = text(item.helpText, '');
      field.required = item.required === true;

      if (TYPE_MAP[item.type].hasOptions && Array.isArray(item.options)) {
        const options = item.options.filter(function (option) { return typeof option === 'string'; });
        if (options.length) field.options = options;
      }

      // Copy only the validation settings this field type actually has.
      const incoming = item.validation && typeof item.validation === 'object' ? item.validation : {};
      Object.keys(VALIDATION_DEFAULTS[item.type]).forEach(function (key) {
        field.validation[key] = cleanRule(item.type, key, field.validation[key], incoming[key]);
      });

      form.fields.push(field);
    });

    return form;
  }

  function cleanRule(type, key, fallback, incoming) {
    if (incoming === undefined) return fallback;
    if (typeof fallback === 'boolean') return incoming === true;

    if (NUMERIC_RULES.indexOf(key) !== -1 && type !== 'date') {
      if (incoming === '' || incoming === null) return '';
      const number = Number(incoming);
      return isFinite(number) ? number : fallback;
    }
    if (key === 'accept') return FormPreview.ACCEPT_TYPES[incoming] ? incoming : 'any';
    return typeof incoming === 'string' ? incoming : fallback;
  }

  // A ready-made example so new users can see what the builder does.
  function sampleForm() {
    const form = createBlankForm();
    form.title = 'Project enquiry';
    form.description = 'Tell us a little about what you need and we’ll reply within two working days.';
    form.submitText = 'Send enquiry';
    form.successMessage = 'Thanks! We’ve got your enquiry.';

    function add(type, changes, rules) {
      const field = createField(type);
      Object.assign(field, changes);
      Object.assign(field.validation, rules || {});
      form.fields.push(field);
    }

    add('text', { label: 'Full name', placeholder: 'Your full name', required: true }, { minLength: 2 });
    add('email', { label: 'Work email', placeholder: 'you@company.com', required: true, helpText: 'We’ll only use this to reply to you.' });
    add('dropdown', { label: 'Project type', required: true, options: ['Website', 'Mobile app', 'Automation', 'Something else'] });
    add('radio', { label: 'Budget range', options: ['Under $1,000', '$1,000 – $5,000', '$5,000 – $15,000', 'Over $15,000'] });
    add('checkbox', { label: 'Services needed', options: ['Design', 'Development', 'AI integration', 'Maintenance'] });
    add('date', { label: 'Preferred start date' });
    add('textarea', { label: 'Project details', placeholder: 'What are you trying to build?', required: true }, { minLength: 20, maxLength: 600 });
    add('file', { label: 'Brief or reference', helpText: 'Optional, but it helps us give a better estimate.' }, { accept: 'pdf', maxSizeMB: 5 });
    return form;
  }

  /* ======================================================================
     3. STATE
     ====================================================================== */

  let form = createBlankForm();
  let selectedId = null;          // which field the properties panel is editing
  let panelTab = 'field';         // 'field' or 'form'
  let lastAddedId = null;         // used to flash a newly added card
  let dragPayload = null;         // what is being dragged: { kind: 'new'|'move', ... }
  let dragDepth = 0;              // counts dragenter/dragleave pairs
  let propCounter = 0;            // for unique ids in the properties panel

  let dom = {};
  let indicatorEl = null;         // the saffron "drop here" line

  // Callbacks provided by app.js (so this file never touches dialogs or toasts itself)
  const hooks = {
    onChange: function () {},     // the form data changed
    onSelect: function () {},     // the user selected something (id, tab)
    onPaletteAdd: function () {}, // the user added a field from the palette
    confirm: function () { return Promise.resolve(true); },
    toast: function () {}
  };

  const byId = function (id) { return document.getElementById(id); };
  const getField = function (id) { return form.fields.find(function (field) { return field.id === id; }) || null; };
  const indexOfField = function (id) { return form.fields.findIndex(function (field) { return field.id === id; }); };
  const emit = function () { hooks.onChange(form); };

  /* ======================================================================
     4. EDITING OPERATIONS
     ====================================================================== */

  function addField(type, index) {
    if (!TYPE_MAP[type]) return null;

    const field = createField(type);
    const position = typeof index === 'number' ? Math.max(0, Math.min(index, form.fields.length)) : form.fields.length;
    form.fields.splice(position, 0, field);

    selectedId = field.id;
    panelTab = 'field';
    lastAddedId = field.id;
    renderCanvas();
    renderPanel();
    emit();
    return field;
  }

  function removeField(id) {
    const index = indexOfField(id);
    if (index === -1) return;
    form.fields.splice(index, 1);
    if (selectedId === id) selectedId = null;
    renderCanvas();
    renderPanel();
    emit();
  }

  // Ask first, then delete.
  function requestDelete(id) {
    const field = getField(id);
    if (!field) return;
    hooks.confirm({
      title: 'Delete this field?',
      message: '“' + (field.label || 'Untitled field') + '” will be removed from the form. This can’t be undone.',
      confirmText: 'Delete field',
      danger: true
    }).then(function (confirmed) {
      if (!confirmed) return;
      removeField(id);
      hooks.toast('Field deleted.', 'info');
    });
  }

  function duplicateField(id) {
    const index = indexOfField(id);
    if (index === -1) return;

    const copy = clone(form.fields[index]);
    copy.id = uid('fld');
    copy.label = (copy.label || 'Untitled field') + ' (copy)';
    form.fields.splice(index + 1, 0, copy);

    selectedId = copy.id;
    panelTab = 'field';
    lastAddedId = copy.id;
    renderCanvas();
    renderPanel();
    emit();
    hooks.toast('Field duplicated.', 'success');
  }

  /**
   * moveField(id, insertBeforeIndex)
   * `insertBeforeIndex` is a position in the CURRENT list (what the drop line shows),
   * so we correct for the dragged item being removed first.
   */
  function moveField(id, insertBeforeIndex) {
    const from = indexOfField(id);
    if (from === -1) return;

    let to = insertBeforeIndex;
    if (from < to) to--;
    if (to === from) return;

    const moved = form.fields.splice(from, 1)[0];
    form.fields.splice(to, 0, moved);
    lastAddedId = id;
    renderCanvas();
    emit();
  }

  // Used by the up/down buttons and the keyboard (Alt + arrow keys).
  function moveBy(id, delta, keepFocus) {
    const from = indexOfField(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= form.fields.length) return;

    const moved = form.fields.splice(from, 1)[0];
    form.fields.splice(to, 0, moved);
    renderCanvas({ focusId: keepFocus ? id : null });
    emit();
  }

  function clearAllFields() {
    form.fields = [];
    selectedId = null;
    renderCanvas();
    renderPanel();
    emit();
  }

  // Selecting a field shows its settings. `silent` skips telling app.js.
  function selectField(id, silent) {
    selectedId = id;
    if (id) panelTab = 'field';
    updateSelectionUI();
    renderPanel();
    if (!silent) hooks.onSelect(id, panelTab);
  }

  function setTab(tab, notify) {
    panelTab = tab;
    updateSelectionUI();
    renderPanel();
    if (notify) hooks.onSelect(null, tab);
  }

  /* ======================================================================
     5. PALETTE (left sidebar)
     ====================================================================== */

  function buildPalette() {
    const groups = [];
    FIELD_TYPES.forEach(function (definition) {
      if (groups.indexOf(definition.group) === -1) groups.push(definition.group);
    });

    groups.forEach(function (groupName) {
      const section = el('section', { class: 'palette-group' }, [el('h3', { text: groupName })]);

      FIELD_TYPES.filter(function (d) { return d.group === groupName; }).forEach(function (definition) {
        // A <div role="button"> (not <button>) because Firefox can't drag buttons.
        const item = el('div', {
          class: 'palette-item',
          role: 'button',
          tabindex: '0',
          draggable: 'true',
          'data-type': definition.type,
          'aria-label': 'Add ' + definition.name + ' field'
        }, [
          el('span', { class: 'palette-icon', html: icon(definition.type, 18) }),
          el('span', { class: 'palette-text' }, [
            el('span', { class: 'palette-name', text: definition.name }),
            el('span', { class: 'palette-hint', text: definition.hint })
          ])
        ]);

        // Click or keyboard = add at the end (also works on touch screens).
        item.addEventListener('click', function () {
          addField(definition.type);
          hooks.onPaletteAdd();
        });
        item.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            item.click();
          }
        });

        // Drag = add wherever it is dropped.
        item.addEventListener('dragstart', function (event) {
          dragPayload = { kind: 'new', type: definition.type };
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData('text/plain', 'new:' + definition.type);
          dom.sheet.classList.add('is-dragging-any');
        });
        item.addEventListener('dragend', endDrag);

        section.appendChild(item);
      });

      dom.paletteList.appendChild(section);
    });
  }

  /* ======================================================================
     6. CANVAS
     ====================================================================== */

  function isHighlighted(id) { return panelTab === 'field' && selectedId === id; }

  function toolButton(iconName, label, onClick, disabled) {
    return el('button', {
      type: 'button',
      class: 'tool-btn' + (iconName === 'trash' ? ' tool-btn--danger' : ''),
      'aria-label': label,
      title: label,
      disabled: disabled ? true : false,
      html: icon(iconName, 16),
      onclick: function (event) { event.stopPropagation(); onClick(); }
    });
  }

  // One field "card" on the canvas.
  function buildCard(field, index) {
    const card = el('article', {
      class: 'field-card' + (isHighlighted(field.id) ? ' is-selected' : ''),
      draggable: 'true',
      tabindex: '0',
      'data-id': field.id,
      'aria-label': (field.label || 'Untitled field') + ', ' + TYPE_MAP[field.type].name + ' field'
    }, [
      el('span', { class: 'card-grip', 'aria-hidden': 'true', title: 'Drag to reorder', html: icon('grip', 18) }),
      FormPreview.buildField(field, { prefix: 'cv', inert: true }),
      el('div', { class: 'card-tools' }, [
        toolButton('up', 'Move up', function () { moveBy(field.id, -1); }, index === 0),
        toolButton('down', 'Move down', function () { moveBy(field.id, 1); }, index === form.fields.length - 1),
        toolButton('copy', 'Duplicate field', function () { duplicateField(field.id); }),
        toolButton('trash', 'Delete field', function () { requestDelete(field.id); })
      ])
    ]);

    card.addEventListener('click', function () { selectField(field.id); });

    // Keyboard: Enter selects, Alt+Up/Down reorders, Delete removes.
    card.addEventListener('keydown', function (event) {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectField(field.id); }
      else if (event.altKey && event.key === 'ArrowUp') { event.preventDefault(); moveBy(field.id, -1, true); }
      else if (event.altKey && event.key === 'ArrowDown') { event.preventDefault(); moveBy(field.id, 1, true); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); requestDelete(field.id); }
    });

    // Dragging an existing card = reordering.
    card.addEventListener('dragstart', function (event) {
      dragPayload = { kind: 'move', id: field.id };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', 'move:' + field.id);
      dom.sheet.classList.add('is-dragging-any');
      setTimeout(function () { card.classList.add('is-dragging'); }, 0);   // after the drag image is captured
    });
    card.addEventListener('dragend', endDrag);

    return card;
  }

  // Redraw every card. Cheap for the size of form this app handles.
  function renderCanvas(options) {
    options = options || {};
    const fragment = document.createDocumentFragment();
    form.fields.forEach(function (field, index) { fragment.appendChild(buildCard(field, index)); });
    dom.fieldList.replaceChildren(fragment);

    const isEmpty = form.fields.length === 0;
    dom.sheet.dataset.empty = String(isEmpty);
    dom.emptyState.hidden = !isEmpty;

    if (lastAddedId) {
      const card = dom.fieldList.querySelector('[data-id="' + CSS.escape(lastAddedId) + '"]');
      if (card) {
        card.classList.add('just-added');
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      lastAddedId = null;
    }
    if (options.focusId) {
      const card = dom.fieldList.querySelector('[data-id="' + CSS.escape(options.focusId) + '"]');
      if (card) card.focus({ preventScroll: true });
    }
  }

  // Toggle the "selected" look without redrawing the cards.
  function updateSelectionUI() {
    dom.fieldList.querySelectorAll('.field-card').forEach(function (card) {
      card.classList.toggle('is-selected', isHighlighted(card.dataset.id));
    });
  }

  // The title/description at the top of the sheet.
  function syncHeader() {
    dom.titleInput.value = form.title;
    dom.descInput.value = form.description;
    autoGrow(dom.descInput);
    dom.sheetSubmit.textContent = form.submitText || 'Submit';
    dom.sheetFoot.className = 'sheet-foot sheet-foot--' + form.submitAlign;
  }

  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  /* ======================================================================
     7. DRAG AND DROP (native HTML5 API)

     How it works:
       dragstart  (palette item or card)  remember what is being dragged
       dragover   (on the sheet)          work out where it would land, show the line
       drop       (on the sheet)          add or move the field there
       dragend                            clean up, even if dropped outside
     ====================================================================== */

  // Which position in the list is the pointer closest to? Returns 0..fields.length.
  function getDropIndex(pointerY) {
    const cards = dom.fieldList.querySelectorAll('.field-card');
    for (let i = 0; i < cards.length; i++) {
      const box = cards[i].getBoundingClientRect();
      if (pointerY < box.top + box.height / 2) return i;   // above this card's midpoint
    }
    return cards.length;                                    // below every card
  }

  function showIndicator(index) {
    if (!indicatorEl) indicatorEl = el('div', { class: 'drop-indicator', 'aria-hidden': 'true' });
    const cards = dom.fieldList.querySelectorAll('.field-card');
    if (index >= cards.length) dom.fieldList.appendChild(indicatorEl);
    else dom.fieldList.insertBefore(indicatorEl, cards[index]);
  }

  // Scroll the canvas when the pointer nears its top or bottom edge.
  function autoScroll(pointerY) {
    const box = dom.canvasScroll.getBoundingClientRect();
    const edge = 70;
    if (pointerY < box.top + edge) dom.canvasScroll.scrollTop -= 14;
    else if (pointerY > box.bottom - edge) dom.canvasScroll.scrollTop += 14;
  }

  function clearDragUI() {
    dragDepth = 0;
    dom.sheet.classList.remove('is-drag-over');
    if (indicatorEl && indicatorEl.parentNode) indicatorEl.remove();
  }

  function endDrag() {
    dragPayload = null;
    dom.sheet.classList.remove('is-dragging-any');
    dom.fieldList.querySelectorAll('.is-dragging').forEach(function (card) { card.classList.remove('is-dragging'); });
    clearDragUI();
  }

  function bindDragAndDrop() {
    dom.sheet.addEventListener('dragenter', function (event) {
      if (!dragPayload) return;
      event.preventDefault();
      dragDepth++;
      dom.sheet.classList.add('is-drag-over');
    });

    dom.sheet.addEventListener('dragover', function (event) {
      if (!dragPayload) return;                    // ignore files dragged in from the desktop
      event.preventDefault();                      // this is what allows dropping here
      event.dataTransfer.dropEffect = dragPayload.kind === 'new' ? 'copy' : 'move';
      if (form.fields.length) showIndicator(getDropIndex(event.clientY));
      autoScroll(event.clientY);
    });

    dom.sheet.addEventListener('dragleave', function () {
      if (!dragPayload) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) clearDragUI();
    });

    dom.sheet.addEventListener('drop', function (event) {
      if (!dragPayload) return;
      event.preventDefault();

      const payload = dragPayload;
      const index = getDropIndex(event.clientY);
      endDrag();

      if (payload.kind === 'new') addField(payload.type, index);
      else moveField(payload.id, index);
    });

    document.addEventListener('dragend', endDrag);
  }

  /* ======================================================================
     8. PROPERTIES PANEL (right sidebar)
     ====================================================================== */

  function nextPropId() { propCounter++; return 'prop-' + propCounter; }

  // Redraw the panel, keeping the scroll position.
  function renderPanel() {
    const scrollTop = dom.panelBody.scrollTop;
    dom.tabField.setAttribute('aria-pressed', String(panelTab === 'field'));
    dom.tabForm.setAttribute('aria-pressed', String(panelTab === 'form'));
    dom.tabField.classList.toggle('is-active', panelTab === 'field');
    dom.tabForm.classList.toggle('is-active', panelTab === 'form');

    let content;
    if (panelTab === 'form') content = buildFormSettings();
    else if (getField(selectedId)) content = buildFieldSettings(getField(selectedId));
    else content = buildNoSelection();

    dom.panelBody.replaceChildren(content);
    dom.panelBody.scrollTop = scrollTop;
  }

  function buildNoSelection() {
    return el('div', { class: 'panel-empty' }, [
      el('span', { class: 'panel-empty-icon', html: icon('sliders', 26) }),
      el('h3', { text: 'Nothing selected' }),
      el('p', { text: form.fields.length ? 'Click a field on the form to change its label, rules and options.' : 'Add a field first, then click it to change how it works.' })
    ]);
  }

  /* ---- Small form-control factories for the panel ---- */

  function iconButton(iconName, label, onClick, variant) {
    return el('button', {
      type: 'button',
      class: 'icon-btn' + (variant ? ' icon-btn--' + variant : ''),
      'aria-label': label,
      title: label,
      html: icon(iconName, 18),
      onclick: onClick
    });
  }

  // A text / number / date input (or textarea) wired to a callback.
  function textInput(value, onInput, options) {
    options = options || {};
    const input = el(options.multiline ? 'textarea' : 'input', {
      id: options.id || nextPropId(),
      class: 'input',
      type: options.multiline ? false : (options.type || 'text'),
      rows: options.multiline ? (options.rows || 3) : false,
      placeholder: options.placeholder,
      min: options.min,
      step: options.step,
      autocomplete: 'off',
      spellcheck: options.spellcheck === false ? 'false' : false
    });
    input.value = value;
    input.addEventListener('input', function () { onInput(input.value); });
    return input;
  }

  // Label + control + optional hint, stacked.
  function row(labelText, input, hint) {
    return el('div', { class: 'prop-row' }, [
      el('label', { class: 'prop-label', for: input.id, text: labelText }),
      input,
      hint ? el('p', { class: 'prop-hint', text: hint }) : null
    ]);
  }

  function switchRow(labelText, checked, onChange, hint) {
    const id = nextPropId();
    const input = el('input', { type: 'checkbox', id: id, role: 'switch' });
    input.checked = checked;
    input.addEventListener('change', function () { onChange(input.checked); });
    return el('div', { class: 'prop-row' }, [
      el('label', { class: 'switch', for: id }, [
        input,
        el('span', { class: 'switch-track', 'aria-hidden': 'true' }),
        el('span', { class: 'switch-text', text: labelText })
      ]),
      hint ? el('p', { class: 'prop-hint', text: hint }) : null
    ]);
  }

  function selectInput(value, choices, onChange) {
    const select = el('select', { id: nextPropId(), class: 'input' });
    choices.forEach(function (choice) { select.appendChild(el('option', { value: choice.value, text: choice.label })); });
    select.value = value;
    select.addEventListener('change', function () { onChange(select.value); });
    return select;
  }

  function section(title, children) {
    return el('section', { class: 'prop-section' }, [el('h3', { text: title })].concat(children));
  }

  /* ---- Field settings ---- */

  // After a text edit we only redraw the canvas (not the panel), so typing keeps its focus.
  function touch() { renderCanvas(); emit(); }

  function buildFieldSettings(field) {
    const definition = TYPE_MAP[field.type];
    const stack = el('div', { class: 'prop-stack' });

    stack.appendChild(el('div', { class: 'prop-head' }, [
      el('span', { class: 'prop-type-icon', html: icon(field.type, 20) }),
      el('div', { class: 'prop-head-text' }, [
        el('strong', { text: definition.name }),
        el('span', { text: definition.hint })
      ]),
      el('div', { class: 'prop-head-actions' }, [
        iconButton('copy', 'Duplicate field', function () { duplicateField(field.id); }),
        iconButton('trash', 'Delete field', function () { requestDelete(field.id); }, 'danger')
      ])
    ]));

    // Basics
    const basics = [
      row('Label', textInput(field.label, function (value) { field.label = value; touch(); }, { placeholder: 'Untitled field' }))
    ];
    if (PLACEHOLDER_TYPES.indexOf(field.type) !== -1) {
      basics.push(row(field.type === 'dropdown' ? 'First option text' : 'Placeholder',
        textInput(field.placeholder, function (value) { field.placeholder = value; touch(); })));
    }
    basics.push(row('Help text', textInput(field.helpText, function (value) { field.helpText = value; touch(); }, { placeholder: 'Shown under the field' })));
    basics.push(switchRow('Required', field.required, function (checked) { field.required = checked; touch(); },
      'Visitors can’t submit without filling this in.'));
    stack.appendChild(section('Basics', basics));

    if (definition.hasOptions) stack.appendChild(buildOptionsEditor(field));

    const rules = buildValidation(field);
    if (rules) stack.appendChild(rules);

    return stack;
  }

  /* ---- Options editor (dropdown, radio, checkbox) ---- */

  function buildOptionsEditor(field) {
    const list = el('div', { class: 'opt-list' });

    field.options.forEach(function (optionText, index) {
      const input = el('input', { type: 'text', class: 'input', 'aria-label': 'Option ' + (index + 1), autocomplete: 'off' });
      input.value = optionText;
      input.addEventListener('input', function () { field.options[index] = input.value; touch(); });
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); addOption(field, index + 1); }   // Enter = next option
      });

      const remove = iconButton('close', 'Remove option ' + (index + 1), function () { removeOption(field, index); });
      remove.disabled = field.options.length <= 1;

      list.appendChild(el('div', { class: 'opt-row' }, [input, remove]));
    });

    const addButton = el('button', {
      type: 'button',
      class: 'btn btn-secondary btn-small',
      html: icon('plus', 16) + '<span>Add option</span>',
      onclick: function () { addOption(field, field.options.length); }
    });

    return section('Options', [list, addButton]);
  }

  function addOption(field, position) {
    field.options.splice(position, 0, 'Option ' + (field.options.length + 1));
    renderPanel();
    renderCanvas();
    emit();
    const inputs = dom.panelBody.querySelectorAll('.opt-row input');
    if (inputs[position]) { inputs[position].focus(); inputs[position].select(); }
  }

  function removeOption(field, position) {
    if (field.options.length <= 1) return;
    field.options.splice(position, 1);
    renderPanel();
    renderCanvas();
    emit();
  }

  /* ---- Validation rules ---- */

  // Spot rules that contradict each other, so the author gets told right away.
  function rulesWarning(field) {
    const v = field.validation;
    const set = FormPreview.isSet;

    if (set(v.minLength) && set(v.maxLength) && Number(v.minLength) > Number(v.maxLength)) return 'The minimum length is larger than the maximum.';
    if (field.type === 'number' && set(v.min) && set(v.max) && Number(v.min) > Number(v.max)) return 'The minimum value is larger than the maximum.';
    if (field.type === 'date' && v.min && v.max && v.min > v.max) return 'The earliest date comes after the latest date.';
    if (set(v.minSelected) && set(v.maxSelected) && Number(v.minSelected) > Number(v.maxSelected)) return 'The minimum selection is larger than the maximum.';
    if (set(v.minSelected) && Number(v.minSelected) > field.options.length) return 'You ask for more selections than there are options.';
    if (v.pattern && !FormPreview.isValidPattern(v.pattern)) return 'That isn’t a valid regular expression, so it will be ignored.';
    return '';
  }

  function buildValidation(field) {
    const v = field.validation;
    const rows = [];
    const warning = el('p', { class: 'prop-warn', role: 'status', hidden: true });

    function refreshWarning() {
      const message = rulesWarning(field);
      warning.textContent = message;
      warning.hidden = !message;
    }
    function afterRuleChange() { refreshWarning(); touch(); }

    // A number rule: empty box = no limit.
    function numberRule(key, labelText, options) {
      options = options || {};
      const input = textInput(v[key], function (value) {
        v[key] = value === '' ? '' : Number(value);
        afterRuleChange();
      }, { type: 'number', min: options.min, step: options.step, placeholder: options.placeholder || 'No limit' });
      return row(labelText, input, options.hint);
    }

    switch (field.type) {
      case 'text':
        rows.push(numberRule('minLength', 'Minimum length', { min: 0 }));
        rows.push(numberRule('maxLength', 'Maximum length', { min: 0 }));
        rows.push(row('Pattern', textInput(v.pattern, function (value) { v.pattern = value; afterRuleChange(); },
          { placeholder: '^[A-Z]{3}-\\d{4}$', spellcheck: false }), 'Optional regular expression the answer must match.'));
        rows.push(row('Pattern error message', textInput(v.patternMessage, function (value) { v.patternMessage = value; touch(); },
          { placeholder: 'Use the format ABC-1234' })));
        break;

      case 'email':
        rows.push(row('Only allow this domain', textInput(v.allowedDomain, function (value) { v.allowedDomain = value; touch(); },
          { placeholder: 'company.com', spellcheck: false }), 'Leave empty to accept any email address.'));
        break;

      case 'number':
        rows.push(numberRule('min', 'Minimum value', { step: 'any' }));
        rows.push(numberRule('max', 'Maximum value', { step: 'any' }));
        rows.push(switchRow('Whole numbers only', v.integerOnly, function (checked) { v.integerOnly = checked; touch(); }));
        break;

      case 'textarea':
        rows.push(numberRule('rows', 'Visible rows', { min: 1, placeholder: '4' }));
        rows.push(numberRule('minLength', 'Minimum length', { min: 0 }));
        rows.push(numberRule('maxLength', 'Maximum length', { min: 0, hint: 'A live character counter appears when this is set.' }));
        break;

      case 'checkbox':
        rows.push(numberRule('minSelected', 'Minimum selections', { min: 0 }));
        rows.push(numberRule('maxSelected', 'Maximum selections', { min: 0 }));
        break;

      case 'date':
        rows.push(row('Earliest date', textInput(v.min, function (value) { v.min = value; afterRuleChange(); }, { type: 'date' })));
        rows.push(row('Latest date', textInput(v.max, function (value) { v.max = value; afterRuleChange(); }, { type: 'date' })));
        break;

      case 'file': {
        const choices = Object.keys(FormPreview.ACCEPT_TYPES).map(function (key) {
          return { value: key, label: FormPreview.ACCEPT_TYPES[key].label };
        });
        rows.push(row('Accepted files', selectInput(v.accept, choices, function (value) { v.accept = value; touch(); })));
        rows.push(numberRule('maxSizeMB', 'Maximum size (MB)', { min: 0, step: 'any' }));
        rows.push(switchRow('Allow several files', v.multiple, function (checked) { v.multiple = checked; touch(); }));
        break;
      }

      default:
        return null;   // dropdown and radio only have "Required"
    }

    rows.push(warning);
    refreshWarning();
    return section('Validation', rows);
  }

  /* ---- Form settings tab ---- */

  function buildFormSettings() {
    const stack = el('div', { class: 'prop-stack' });

    // Editing here updates the title on the sheet directly (no full redraw).
    const titleInput = textInput(form.title, function (value) {
      form.title = value;
      if (document.activeElement !== dom.titleInput) dom.titleInput.value = value;
      emit();
    }, { id: 'prop-form-title', placeholder: 'Untitled form' });

    const descInput = textInput(form.description, function (value) {
      form.description = value;
      if (document.activeElement !== dom.descInput) { dom.descInput.value = value; autoGrow(dom.descInput); }
      emit();
    }, { id: 'prop-form-desc', multiline: true, rows: 3, placeholder: 'What is this form for?' });

    stack.appendChild(section('Form details', [row('Title', titleInput), row('Description', descInput)]));

    const submitInput = textInput(form.submitText, function (value) {
      form.submitText = value;
      dom.sheetSubmit.textContent = value || 'Submit';
      emit();
    }, { placeholder: 'Submit' });

    const alignment = el('div', { class: 'segmented segmented--small', role: 'group', 'aria-label': 'Button alignment' },
      ['left', 'center', 'right'].map(function (side) {
        return el('button', {
          type: 'button',
          class: 'seg-btn' + (form.submitAlign === side ? ' is-active' : ''),
          'aria-pressed': String(form.submitAlign === side),
          text: side.charAt(0).toUpperCase() + side.slice(1),
          onclick: function () {
            form.submitAlign = side;
            dom.sheetFoot.className = 'sheet-foot sheet-foot--' + side;
            renderPanel();
            emit();
          }
        });
      }));

    const successInput = textInput(form.successMessage, function (value) { form.successMessage = value; emit(); },
      { multiline: true, rows: 2, placeholder: 'Thanks! Your response has been recorded.' });

    stack.appendChild(section('Submit button', [
      row('Button text', submitInput),
      el('div', { class: 'prop-row' }, [el('span', { class: 'prop-label', text: 'Alignment' }), alignment]),
      row('Message after submitting', successInput)
    ]));

    const clearButton = el('button', {
      type: 'button',
      class: 'btn btn-danger-outline',
      disabled: form.fields.length === 0 ? true : false,
      html: icon('trash', 16) + '<span>Clear all fields</span>',
      onclick: function () {
        hooks.confirm({
          title: 'Clear all fields?',
          message: 'All ' + form.fields.length + ' fields will be removed. The title and settings stay.',
          confirmText: 'Clear fields',
          danger: true
        }).then(function (confirmed) {
          if (!confirmed) return;
          clearAllFields();
          hooks.toast('All fields cleared.', 'info');
        });
      }
    });
    stack.appendChild(section('Danger zone', [clearButton]));

    return stack;
  }

  /* ======================================================================
     9. PUBLIC API
     ====================================================================== */

  function init(config) {
    Object.assign(hooks, config || {});

    dom = {
      paletteList: byId('paletteList'),
      sheet: byId('sheet'),
      canvasScroll: byId('canvasScroll'),
      fieldList: byId('fieldList'),
      emptyState: byId('emptyState'),
      titleInput: byId('titleInput'),
      descInput: byId('descInput'),
      sheetFoot: byId('sheetFoot'),
      sheetSubmit: byId('sheetSubmit'),
      panelBody: byId('panelBody'),
      tabField: byId('tabField'),
      tabForm: byId('tabForm')
    };

    buildPalette();
    bindDragAndDrop();

    // Editing the title/description straight on the sheet.
    dom.titleInput.addEventListener('input', function () {
      form.title = dom.titleInput.value;
      const panelTitle = byId('prop-form-title');
      if (panelTitle) panelTitle.value = form.title;
      emit();
    });
    dom.descInput.addEventListener('input', function () {
      form.description = dom.descInput.value;
      autoGrow(dom.descInput);
      const panelDesc = byId('prop-form-desc');
      if (panelDesc) panelDesc.value = form.description;
      emit();
    });
    [dom.titleInput, dom.descInput].forEach(function (input) {
      input.addEventListener('focus', function () {
        if (panelTab !== 'form' || selectedId) { selectedId = null; setTab('form', false); }
      });
    });
    dom.sheetSubmit.addEventListener('click', function () { selectedId = null; setTab('form', true); });

    dom.tabField.addEventListener('click', function () { setTab('field', false); });
    dom.tabForm.addEventListener('click', function () { setTab('form', false); });
    byId('sampleBtn').addEventListener('click', function () {
      setForm(sampleForm());
      emit();
      hooks.toast('Sample form loaded. Click any field to edit it.', 'success');
    });

    window.addEventListener('resize', function () { autoGrow(dom.descInput); });

    setForm(form);
  }

  // Replace the whole form (new / open / import). Does not call onChange.
  function setForm(newForm) {
    form = newForm;
    selectedId = null;
    panelTab = 'field';
    lastAddedId = null;
    syncHeader();
    renderCanvas();
    renderPanel();
  }

  return {
    init: init,
    icon: icon,
    getForm: function () { return form; },
    getSelectedId: function () { return selectedId; },
    setForm: setForm,
    createBlankForm: createBlankForm,
    normalizeForm: normalizeForm,
    newId: function () { return uid('form'); },
    selectField: selectField
  };
})();
