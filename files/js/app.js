/* ==========================================================================
   app.js — Glues everything together and owns the "chrome" of the page.

   Responsibilities
   - Start the builder and restore the last draft
   - Top bar: New / Open / Export / Save, Build ⇄ Preview, save status
   - Dialogs (confirm, saved forms, export) and toast notifications
   - Live preview and its device-width switcher
   - Side panels that slide in on tablets and phones
   ========================================================================== */
const App = (function () {
  'use strict';

  const el = FormPreview.el;
  const $ = function (selector) { return document.querySelector(selector); };

  let dom = {};
  let mode = 'build';               // 'build' or 'preview'
  let savedSnapshot = '';           // JSON of the form as last saved to the library
  let draftTimer = null;
  let previewTimer = null;

  // Panels become slide-over drawers below these widths (keep in sync with style.css).
  const rightIsDrawer = function () { return window.matchMedia('(max-width: 1179px)').matches; };
  const leftIsDrawer = function () { return window.matchMedia('(max-width: 819px)').matches; };

  /* ======================================================================
     TOASTS
     ====================================================================== */

  function toast(message, type) {
    const kind = type || 'info';
    const iconName = kind === 'success' ? 'check' : (kind === 'error' ? 'alert' : 'list');

    const item = el('div', { class: 'toast toast--' + kind }, [
      el('span', { class: 'toast-icon', html: FormPreview.icon(iconName, 18) }),
      el('span', { class: 'toast-text', text: message })
    ]);

    function dismiss() {
      item.classList.add('is-leaving');
      setTimeout(function () { item.remove(); }, 220);
    }
    item.addEventListener('click', dismiss);

    dom.toasts.appendChild(item);
    while (dom.toasts.children.length > 4) dom.toasts.firstChild.remove();
    setTimeout(dismiss, kind === 'error' ? 5000 : 3200);
  }

  /* ======================================================================
     DIALOGS
     ====================================================================== */

  // Close a <dialog> when its dark backdrop is clicked.
  function closeOnBackdrop(dialog) {
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) dialog.close('cancel');
    });
    dialog.querySelectorAll('[data-close]').forEach(function (button) {
      button.addEventListener('click', function () { dialog.close('cancel'); });
    });
  }

  /**
   * confirmDialog({ title, message, confirmText, danger }) -> Promise<boolean>
   * Resolves true if the person confirmed, false if they cancelled or pressed Esc.
   */
  function confirmDialog(options) {
    return new Promise(function (resolve) {
      dom.confirmTitle.textContent = options.title;
      dom.confirmMessage.textContent = options.message;
      dom.confirmOk.textContent = options.confirmText || 'Confirm';
      dom.confirmOk.className = 'btn ' + (options.danger ? 'btn-danger' : 'btn-primary');

      dom.confirmDialog.returnValue = '';
      dom.confirmDialog.addEventListener('close', function onClose() {
        dom.confirmDialog.removeEventListener('close', onClose);
        resolve(dom.confirmDialog.returnValue === 'ok');
      });
      dom.confirmDialog.showModal();
      dom.confirmCancel.focus();    // safest default: Cancel
    });
  }

  /* ======================================================================
     SAVE STATUS
     ====================================================================== */

  function currentSnapshot() { return JSON.stringify(Builder.getForm()); }
  function isDirty() { return currentSnapshot() !== savedSnapshot; }

  function updateStatus() {
    const form = Builder.getForm();
    let state;
    let text;

    if (savedSnapshot === '') {
      state = form.fields.length ? 'unsaved' : 'new';
      text = form.fields.length ? 'Not saved yet' : 'New form';
    } else if (isDirty()) {
      state = 'unsaved';
      text = 'Unsaved changes';
    } else {
      state = 'saved';
      text = 'Saved';
    }

    dom.status.dataset.state = state;
    dom.status.querySelector('.status-text').textContent = text;
  }

  /* ======================================================================
     BUILDER EVENTS
     ====================================================================== */

  function handleChange() {
    updateStatus();

    // Keep a draft so a page refresh never loses work.
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () { FormStorage.saveDraft(Builder.getForm()); }, 350);

    // Live preview: redraw shortly after the last edit.
    if (mode === 'preview') {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(renderPreview, 150);
    }
  }

  function handleSelect(id, tab) {
    if (mode === 'preview') FormPreview.setSelected(dom.previewMount, id);
    // On small screens, selecting something opens the properties drawer.
    if (rightIsDrawer() && (id || tab === 'form')) openDrawer('right');
  }

  /* ======================================================================
     BUILD / PREVIEW
     ====================================================================== */

  function renderPreview() {
    FormPreview.render(Builder.getForm(), dom.previewMount, {
      prefix: 'pv',
      selectedId: Builder.getSelectedId(),
      // Clicking a field in the preview selects it (not on phones, where taps are for testing).
      onSelect: rightIsDrawer() ? null : function (id) { Builder.selectField(id); },
      onInvalid: function (count) {
        toast(count === 1 ? '1 field needs your attention.' : count + ' fields need your attention.', 'error');
      },
      onSuccess: function () { toast('Form submitted. This is only a preview.', 'success'); }
    });
  }

  function setMode(nextMode) {
    mode = nextMode;
    dom.app.dataset.mode = mode;
    dom.modeBuild.setAttribute('aria-pressed', String(mode === 'build'));
    dom.modePreview.setAttribute('aria-pressed', String(mode === 'preview'));
    dom.modeBuild.classList.toggle('is-active', mode === 'build');
    dom.modePreview.classList.toggle('is-active', mode === 'preview');
    closeDrawers();
    dom.canvasScroll.scrollTop = 0;
    if (mode === 'preview') renderPreview();
  }

  function setDevice(device) {
    dom.device.dataset.device = device;
    dom.deviceButtons.forEach(function (button) {
      const active = button.dataset.device === device;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  /* ======================================================================
     DRAWERS (tablet and phone)
     ====================================================================== */

  function openDrawer(side) {
    closeDrawers();
    (side === 'left' ? dom.leftPanel : dom.rightPanel).classList.add('is-open');
    dom.backdrop.classList.add('is-visible');
  }

  function closeDrawers() {
    dom.leftPanel.classList.remove('is-open');
    dom.rightPanel.classList.remove('is-open');
    dom.backdrop.classList.remove('is-visible');
  }

  /* ======================================================================
     FILE MENU ACTIONS: new, save, open, import, export
     ====================================================================== */

  // Replace the current form with another one (after asking, if work would be lost).
  function replaceForm(newForm, options) {
    options = options || {};
    return Promise.resolve(isDirty() && Builder.getForm().fields.length ? confirmDialog({
      title: 'Replace the current form?',
      message: 'You have changes that aren’t saved to your library. Opening another form will replace them.',
      confirmText: 'Replace form',
      danger: true
    }) : true).then(function (confirmed) {
      if (!confirmed) return false;

      Builder.setForm(newForm);
      savedSnapshot = options.saved ? currentSnapshot() : '';
      FormStorage.saveDraft(Builder.getForm());
      updateStatus();
      if (mode === 'preview') renderPreview();
      return true;
    });
  }

  function newForm() {
    replaceForm(Builder.createBlankForm()).then(function (done) {
      if (done) toast('Started a new form.', 'info');
    });
  }

  function saveToLibrary() {
    const form = Builder.getForm();
    if (!form.title.trim()) {
      toast('Give your form a title before saving.', 'error');
      dom.titleInput.focus();
      return;
    }
    if (FormStorage.saveForm(form)) {
      savedSnapshot = currentSnapshot();
      FormStorage.saveDraft(form);
      updateStatus();
      toast('Saved “' + form.title + '” to your library.', 'success');
    } else {
      toast('Couldn’t save. Browser storage is full or blocked.', 'error');
    }
  }

  function timeAgo(timestamp) {
    const seconds = Math.round((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' h ago';
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function renderLibrary() {
    const items = FormStorage.listForms();
    const currentId = Builder.getForm().id;
    dom.libraryList.replaceChildren();

    if (!items.length) {
      dom.libraryList.appendChild(el('div', { class: 'lib-empty' }, [
        el('strong', { text: 'No saved forms yet' }),
        el('p', { text: 'Press Save in the top bar to keep a form here, or import a JSON file below.' })
      ]));
      return;
    }

    items.forEach(function (item) {
      dom.libraryList.appendChild(el('div', { class: 'lib-item' }, [
        el('div', { class: 'lib-info' }, [
          el('strong', { text: item.title }),
          el('span', { text: item.fieldCount + (item.fieldCount === 1 ? ' field' : ' fields') + ' · edited ' + timeAgo(item.updatedAt) })
        ]),
        item.id === currentId ? el('span', { class: 'chip', text: 'Open now' }) : null,
        el('div', { class: 'lib-actions' }, [
          el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Open', onclick: function () { openSaved(item.id); } }),
          el('button', {
            type: 'button',
            class: 'icon-btn icon-btn--danger',
            'aria-label': 'Delete ' + item.title,
            title: 'Delete',
            html: FormPreview.icon('trash', 18),
            onclick: function () { deleteSaved(item); }
          })
        ])
      ]));
    });
  }

  function openLibrary() {
    renderLibrary();
    dom.libraryDialog.showModal();
  }

  function openSaved(id) {
    const form = Builder.normalizeForm(FormStorage.loadForm(id));
    if (!form) { toast('That saved form is damaged and can’t be opened.', 'error'); return; }

    dom.libraryDialog.close('cancel');
    replaceForm(form, { saved: true }).then(function (done) {
      if (done) toast('Opened “' + form.title + '”.', 'success');
    });
  }

  function deleteSaved(item) {
    confirmDialog({
      title: 'Delete “' + item.title + '”?',
      message: 'It will be removed from your library. This can’t be undone.',
      confirmText: 'Delete form',
      danger: true
    }).then(function (confirmed) {
      if (!confirmed) return;
      FormStorage.deleteForm(item.id);
      if (item.id === Builder.getForm().id) { savedSnapshot = ''; updateStatus(); }
      renderLibrary();
      toast('Deleted “' + item.title + '”.', 'info');
    });
  }

  function importFile(file) {
    if (!file) return;
    const reader = new FileReader();

    reader.onload = function () {
      const form = Builder.normalizeForm(FormStorage.parseJSON(String(reader.result)));
      if (!form) { toast('That file isn’t a Formwright form (JSON with a "fields" list).', 'error'); return; }

      form.id = Builder.newId();   // never overwrite a form already in the library
      dom.libraryDialog.close('cancel');
      replaceForm(form).then(function (done) {
        if (done) toast('Imported “' + form.title + '”. Press Save to keep it.', 'success');
      });
    };
    reader.onerror = function () { toast('Couldn’t read that file.', 'error'); };
    reader.readAsText(file);
  }

  function openExport() {
    dom.exportText.value = FormStorage.toJSONString(Builder.getForm());
    dom.exportDialog.showModal();
  }

  function copyExport() {
    const text = dom.exportText.value;
    const fallback = function () {
      dom.exportText.select();
      try { document.execCommand('copy'); toast('JSON copied to the clipboard.', 'success'); }
      catch (error) { toast('Couldn’t copy. Select the text and copy it manually.', 'error'); }
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('JSON copied to the clipboard.', 'success'); }, fallback);
    } else {
      fallback();
    }
  }

  /* ======================================================================
     START UP
     ====================================================================== */

  function init() {
    // Fill every <span data-icon="..."> placeholder with its SVG.
    document.querySelectorAll('[data-icon]').forEach(function (node) {
      node.innerHTML = FormPreview.icon(node.dataset.icon, Number(node.dataset.size) || 18);
    });

    dom = {
      app: $('#app'),
      leftPanel: $('#leftPanel'),
      rightPanel: $('#rightPanel'),
      backdrop: $('#backdrop'),
      canvasScroll: $('#canvasScroll'),
      titleInput: $('#titleInput'),
      modeBuild: $('#modeBuild'),
      modePreview: $('#modePreview'),
      status: $('#saveStatus'),
      toasts: $('#toasts'),
      device: $('#device'),
      deviceButtons: Array.from(document.querySelectorAll('[data-device]')).filter(function (b) { return b.tagName === 'BUTTON'; }),
      previewMount: $('#previewMount'),
      confirmDialog: $('#confirmDialog'),
      confirmTitle: $('#confirmTitle'),
      confirmMessage: $('#confirmMessage'),
      confirmOk: $('#confirmOk'),
      confirmCancel: $('#confirmCancel'),
      libraryDialog: $('#libraryDialog'),
      libraryList: $('#libraryList'),
      exportDialog: $('#exportDialog'),
      exportText: $('#exportText')
    };

    Builder.init({
      onChange: handleChange,
      onSelect: handleSelect,
      onPaletteAdd: function () { if (leftIsDrawer()) closeDrawers(); },
      confirm: confirmDialog,
      toast: toast
    });

    // Restore the last draft, if there is one.
    const draft = Builder.normalizeForm(FormStorage.loadDraft());
    if (draft) {
      Builder.setForm(draft);
      const stored = Builder.normalizeForm(FormStorage.loadForm(draft.id));
      savedSnapshot = stored ? JSON.stringify(stored) : '';
      if (draft.fields.length) toast('Restored your last draft.', 'info');
    }
    updateStatus();

    // Top bar
    dom.modeBuild.addEventListener('click', function () { setMode('build'); });
    dom.modePreview.addEventListener('click', function () { setMode('preview'); });
    $('#btnNew').addEventListener('click', newForm);
    $('#btnOpen').addEventListener('click', openLibrary);
    $('#btnExport').addEventListener('click', openExport);
    $('#btnSave').addEventListener('click', saveToLibrary);
    dom.deviceButtons.forEach(function (button) {
      button.addEventListener('click', function () { setDevice(button.dataset.device); });
    });

    // Drawers and dock (tablet / phone)
    $('#dockFields').addEventListener('click', function () { openDrawer('left'); });
    $('#dockProps').addEventListener('click', function () { openDrawer('right'); });
    document.querySelectorAll('.drawer-close').forEach(function (button) { button.addEventListener('click', closeDrawers); });
    dom.backdrop.addEventListener('click', closeDrawers);
    window.matchMedia('(min-width: 1180px)').addEventListener('change', closeDrawers);

    // Dialogs
    [dom.libraryDialog, dom.exportDialog, dom.confirmDialog].forEach(closeOnBackdrop);
    $('#importInput').addEventListener('change', function (event) {
      importFile(event.target.files[0]);
      event.target.value = '';      // allow importing the same file again
    });
    $('#exportCopy').addEventListener('click', copyExport);
    $('#exportDownload').addEventListener('click', function () {
      FormStorage.downloadJSON(Builder.getForm());
      toast('Downloading JSON file.', 'success');
    });

    // Keyboard shortcuts: Ctrl/Cmd+S saves, Escape closes drawers.
    document.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveToLibrary();
      } else if (event.key === 'Escape') {
        closeDrawers();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { toast: toast, confirm: confirmDialog };
})();
