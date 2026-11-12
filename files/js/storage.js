/* ==========================================================================
   storage.js — Saving, loading and exporting forms.

   Responsibilities
   - Keep a "library" of saved forms in localStorage
   - Keep an automatic "draft" of the form being edited
   - Export a form as a downloadable .json file

   This file knows nothing about the page (no buttons, no dialogs).
   Everything that can fail returns true/false or null so callers can react.
   ========================================================================== */
const FormStorage = (function () {
  'use strict';

  const LIBRARY_KEY = 'formwright.library.v1';
  const DRAFT_KEY = 'formwright.draft.v1';

  /* ---------- Low-level helpers ---------- */

  // Read and parse JSON from localStorage. Returns `fallback` on any problem.
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.warn('Could not read "' + key + '" from storage:', error);
      return fallback;
    }
  }

  // Stringify and write JSON. Returns false if storage is full or blocked.
  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn('Could not write "' + key + '" to storage:', error);
      return false;
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /* ---------- The library of saved forms ---------- */
  // Shape in storage: { "<formId>": { form: {...}, updatedAt: 1700000000000 } }

  function getLibrary() {
    const library = readJSON(LIBRARY_KEY, {});
    const isPlainObject = library && typeof library === 'object' && !Array.isArray(library);
    return isPlainObject ? library : {};
  }

  // A light summary of every saved form, newest first (for the "Open" dialog).
  function listForms() {
    const library = getLibrary();
    const summaries = [];

    Object.keys(library).forEach(function (id) {
      const entry = library[id] || {};
      const form = entry.form || {};
      summaries.push({
        id: id,
        title: form.title || 'Untitled form',
        fieldCount: Array.isArray(form.fields) ? form.fields.length : 0,
        updatedAt: entry.updatedAt || 0
      });
    });

    summaries.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return summaries;
  }

  function loadForm(id) {
    const entry = getLibrary()[id];
    return entry ? entry.form : null;
  }

  function saveForm(form) {
    const library = getLibrary();
    library[form.id] = { form: clone(form), updatedAt: Date.now() };
    return writeJSON(LIBRARY_KEY, library);
  }

  function deleteForm(id) {
    const library = getLibrary();
    delete library[id];
    return writeJSON(LIBRARY_KEY, library);
  }

  /* ---------- The automatic draft ---------- */

  function saveDraft(form) { return writeJSON(DRAFT_KEY, form); }
  function loadDraft() { return readJSON(DRAFT_KEY, null); }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (error) { /* ignore */ }
  }

  /* ---------- Export / import ---------- */

  // Pretty-printed JSON text of a form (with a version number for the future).
  function toJSONString(form) {
    return JSON.stringify(Object.assign({ version: 1 }, form), null, 2);
  }

  // "My Contact Form!" -> "my-contact-form"
  function slugify(text) {
    const slug = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || 'form';
  }

  // Trigger a browser download of the form as a .json file.
  function downloadJSON(form) {
    const blob = new Blob([toJSONString(form)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = slugify(form.title) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // Parse text from an imported file. Returns null if it is not valid JSON.
  function parseJSON(text) {
    try { return JSON.parse(text); } catch (error) { return null; }
  }

  return {
    listForms: listForms,
    loadForm: loadForm,
    saveForm: saveForm,
    deleteForm: deleteForm,
    saveDraft: saveDraft,
    loadDraft: loadDraft,
    clearDraft: clearDraft,
    toJSONString: toJSONString,
    downloadJSON: downloadJSON,
    parseJSON: parseJSON
  };
})();
