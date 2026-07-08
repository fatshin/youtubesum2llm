/**
 * SumVid - Popup Settings Page
 * Manages prompt templates, extension settings, and user preferences.
 */

(() => {
  'use strict';

  const BUILTIN_TEMPLATES = [
    { id: 'summary', icon: '📝', nameKey: 'templateSummary', name: '要約', desc: 'タイムライン付き要約' },
    { id: 'deepresearch', icon: '🔍', nameKey: 'templateDeepresearch', name: '深掘りリサーチ', desc: 'ファクトチェック+関連トピック分析' },
    { id: 'keypoints', icon: '🎯', nameKey: 'templateKeypoints', name: 'キーポイント', desc: 'タイムスタンプ付き重要ポイント' },
    { id: 'mindmap', icon: '🗺️', nameKey: 'templateMindmap', name: 'マインドマップ', desc: '階層的トピック構造' },
    { id: 'translation', icon: '🌐', nameKey: 'templateTranslation', name: '翻訳+要約', desc: '翻訳して要約' },
    { id: 'notes', icon: '📚', nameKey: 'templateNotes', name: '学習ノート', desc: 'コーネル式ノート' },
  ];

  const DEFAULT_SETTINGS = {
    defaultAI: 'claude',
    panelAutoOpen: false,
    showTimestamps: true,
    includeMetadata: true,
  };

  let currentEditingTemplate = null;

  /**
   * i18n helper
   */
  function msg(key, substitutions) {
    try {
      const m = chrome.i18n.getMessage(key, substitutions);
      return m || key;
    } catch {
      return key;
    }
  }

  /**
   * Apply i18n to data-i18n elements
   */
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const message = msg(key);
      if (message && message !== key) {
        el.textContent = message;
      }
    });
  }

  /**
   * Show toast notification
   */
  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  /**
   * Tab switching
   */
  function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
      });
    });
  }

  /**
   * Render template list
   */
  async function renderTemplates() {
    const list = document.getElementById('templateList');
    const result = await chrome.storage.sync.get('activeTemplate');
    const activeId = result.activeTemplate || 'summary';

    // Safe DOM construction (no innerHTML — XSS prevention)
    list.textContent = '';
    for (const t of BUILTIN_TEMPLATES) {
      const item = document.createElement('div');
      item.className = `template-item${t.id === activeId ? ' active' : ''}`;
      item.dataset.template = t.id;

      const icon = document.createElement('span');
      icon.className = 'template-icon';
      icon.textContent = t.icon;

      const info = document.createElement('div');
      info.className = 'template-info';

      const name = document.createElement('div');
      name.className = 'template-name';
      const i18nName = msg(t.nameKey);
      name.textContent = (i18nName !== t.nameKey) ? i18nName : t.name;

      const desc = document.createElement('div');
      desc.className = 'template-desc';
      desc.textContent = t.desc;

      info.appendChild(name);
      info.appendChild(desc);
      item.appendChild(icon);
      item.appendChild(info);
      list.appendChild(item);

      // Click handler
      item.addEventListener('click', () => {
        list.querySelectorAll('.template-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        chrome.storage.sync.set({ activeTemplate: t.id });
        openTemplateEditor(t.id);
      });
    }
  }

  /**
   * Open template editor
   */
  /**
   * Normalize stored template entry (handles both string and object formats)
   */
  function normalizeTemplateEntry(entry) {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && entry.prompt) return entry.prompt;
    return null;
  }

  async function openTemplateEditor(templateId) {
    currentEditingTemplate = templateId;
    const editorSection = document.getElementById('editorSection');
    const editor = document.getElementById('promptEditor');
    const title = document.getElementById('editorTitle');

    const template = BUILTIN_TEMPLATES.find(t => t.id === templateId);
    title.textContent = `Edit: ${template?.name || templateId}`;

    // Load custom prompt if saved, otherwise load built-in via background
    const result = await chrome.storage.sync.get('promptTemplates');
    const customs = result.promptTemplates || {};
    const customPrompt = normalizeTemplateEntry(customs[templateId]);

    if (customPrompt) {
      editor.value = customPrompt;
    } else {
      editor.value = await loadBuiltinPrompt(templateId);
    }

    editorSection.style.display = 'block';
  }

  /**
   * Load a built-in template prompt via background script (no fetch+regex)
   */
  async function loadBuiltinPrompt(templateId) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'SUMVID_GET_TEMPLATE', id: templateId }, (response) => {
        if (response?.success) {
          resolve(response.prompt);
        } else {
          resolve('Please summarize the following video transcript.\n\n{{TRANSCRIPT}}');
        }
      });
    });
  }

  /**
   * Save custom prompt
   */
  async function saveCurrentPrompt() {
    if (!currentEditingTemplate) return;

    const editor = document.getElementById('promptEditor');
    const result = await chrome.storage.sync.get('promptTemplates');
    const customs = result.promptTemplates || {};

    customs[currentEditingTemplate] = { prompt: editor.value };
    await chrome.storage.sync.set({ promptTemplates: customs });
    showToast(msg('btnSave') + ' ✓');
  }

  /**
   * Reset current template to built-in default
   */
  async function resetCurrentPrompt() {
    if (!currentEditingTemplate) return;

    const editor = document.getElementById('promptEditor');
    editor.value = await loadBuiltinPrompt(currentEditingTemplate);

    // Remove custom override
    const result = await chrome.storage.sync.get('promptTemplates');
    const customs = result.promptTemplates || {};
    delete customs[currentEditingTemplate];
    await chrome.storage.sync.set({ promptTemplates: customs });
    showToast(msg('btnReset') + ' ✓');
  }

  /**
   * Load and apply settings
   */
  async function loadSettings() {
    const result = await chrome.storage.sync.get('settings');
    const settings = { ...DEFAULT_SETTINGS, ...(result.settings || {}) };

    document.getElementById('settingDefaultAI').value = settings.defaultAI;
    document.getElementById('settingAutoOpen').checked = settings.panelAutoOpen;
    document.getElementById('settingTimestamps').checked = settings.showTimestamps;
    document.getElementById('settingMetadata').checked = settings.includeMetadata;
  }

  /**
   * Save a single setting
   */
  async function saveSetting(key, value) {
    const result = await chrome.storage.sync.get('settings');
    const settings = { ...DEFAULT_SETTINGS, ...(result.settings || {}), [key]: value };
    await chrome.storage.sync.set({ settings });
  }

  /**
   * Setup settings event listeners
   */
  function setupSettings() {
    document.getElementById('settingDefaultAI').addEventListener('change', (e) => {
      saveSetting('defaultAI', e.target.value);
    });

    document.getElementById('settingAutoOpen').addEventListener('change', (e) => {
      saveSetting('panelAutoOpen', e.target.checked);
    });

    document.getElementById('settingTimestamps').addEventListener('change', (e) => {
      saveSetting('showTimestamps', e.target.checked);
    });

    document.getElementById('settingMetadata').addEventListener('change', (e) => {
      saveSetting('includeMetadata', e.target.checked);
    });
  }

  /**
   * Setup prompt editor buttons
   */
  function setupEditor() {
    document.getElementById('btnSavePrompt').addEventListener('click', saveCurrentPrompt);
    document.getElementById('btnResetPrompt').addEventListener('click', resetCurrentPrompt);
    document.getElementById('btnCancelEdit').addEventListener('click', () => {
      document.getElementById('editorSection').style.display = 'none';
      currentEditingTemplate = null;
    });
  }

  /**
   * Initialize popup
   */
  async function init() {
    applyI18n();
    setupTabs();
    setupEditor();
    setupSettings();
    await renderTemplates();
    await loadSettings();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
