/**
 * SumVid - YouTube Side Panel
 * Injects a native-looking panel into YouTube's sidebar with transcript display,
 * timestamp jump, AI service buttons, and template selection.
 *
 * Review fixes applied:
 * - [HIGH] yt-navigate-finish event instead of MutationObserver (Gemini)
 * - [HIGH] Template loading via background message instead of fetch+regex (Codex+Gemini)
 * - [MEDIUM] innerHTML replaced with safe DOM construction (Gemini)
 * - [MEDIUM] Description expand before transcript button search (Gemini)
 * - [MEDIUM] Settings (defaultAI, showTimestamps, includeMetadata) now applied (Codex)
 */

(() => {
  'use strict';

  const AI_SERVICES = {
    gemini: { name: 'Gemini', url: 'https://gemini.google.com/app/new', icon: '\u2728' },
    chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/?model=auto', icon: '\u{1F916}' },
    claude: { name: 'Claude', url: 'https://claude.ai/new', icon: '\u{1F7E0}' },
    grok: { name: 'Grok', url: 'https://grok.com/', icon: '\u26a1' },
  };

  const BUILTIN_TEMPLATE_OPTIONS = [
    { id: 'summary', icon: '\u{1F4DD}' },
    { id: 'deepresearch', icon: '\u{1F50D}' },
    { id: 'keypoints', icon: '\u{1F3AF}' },
    { id: 'mindmap', icon: '\u{1F5FA}\uFE0F' },
    { id: 'translation', icon: '\u{1F310}' },
    { id: 'notes', icon: '\u{1F4DA}' },
    { id: 'podcast', icon: '\u{1F399}️' },
  ];

  let panelState = {
    collapsed: false,
    segments: null,
    transcript: null,
    metadata: null,
    loading: false,
    activeTemplate: 'summary',
    settings: {
      defaultAI: 'gemini',
      showTimestamps: true,
      includeMetadata: true,
    },
  };

  /**
   * Get i18n message with fallback
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
   * Safely create a text node or element — no innerHTML
   */
  function el(tag, attrs = {}, children = []) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'textContent') {
        element.textContent = value;
      } else if (key.startsWith('data')) {
        element.setAttribute(key.replace(/([A-Z])/g, '-$1').toLowerCase(), value);
      } else {
        element.setAttribute(key, value);
      }
    }
    for (const child of children) {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else if (child) {
        element.appendChild(child);
      }
    }
    return element;
  }

  /**
   * Create the panel using safe DOM construction
   */
  function createPanel() {
    const panel = el('div', { id: 'sumvid-panel' });

    // Header
    const header = el('div', { className: 'sumvid-header', role: 'button', tabindex: '0', 'aria-expanded': 'true' }, [
      el('div', { className: 'sumvid-header-left' }, [
        el('span', { className: 'sumvid-logo', textContent: 'SumVid' }),
        el('span', { className: 'sumvid-badge', textContent: 'AI' }),
      ]),
      el('button', { className: 'sumvid-toggle-btn', 'aria-label': msg('panelCollapse'), textContent: '\u25B2' }),
    ]);
    panel.appendChild(header);

    // Body
    const body = el('div', { className: 'sumvid-body' });

    // Template selector row
    const templateRow = el('div', { className: 'sumvid-template-row' });
    const templateSelect = el('select', { className: 'sumvid-template-select', 'aria-label': 'Prompt template' });
    for (const t of BUILTIN_TEMPLATE_OPTIONS) {
      const opt = el('option', { value: t.id, textContent: `${t.icon} ${msg('template' + t.id.charAt(0).toUpperCase() + t.id.slice(1))}` });
      if (t.id === panelState.activeTemplate) opt.selected = true;
      templateSelect.appendChild(opt);
    }
    templateRow.appendChild(templateSelect);
    body.appendChild(templateRow);

    // Action buttons
    const actions = el('div', { className: 'sumvid-actions' });
    actions.appendChild(el('button', { className: 'sumvid-btn sumvid-btn-primary', 'data-action': 'get-transcript', textContent: msg('btnGetTranscript') }));
    actions.appendChild(el('button', { className: 'sumvid-btn sumvid-btn-icon', 'data-action': 'copy', disabled: 'true', title: msg('btnCopy'), textContent: '\u{1F4CB}' }));
    body.appendChild(actions);

    // AI service buttons
    const aiRow = el('div', { className: 'sumvid-ai-row' });
    for (const [key, svc] of Object.entries(AI_SERVICES)) {
      aiRow.appendChild(el('button', {
        className: 'sumvid-btn sumvid-btn-secondary',
        'data-action': 'send-ai',
        'data-service': key,
        disabled: 'true',
        textContent: `${svc.icon} ${svc.name}`,
      }));
    }
    body.appendChild(aiRow);

    // Transcript container
    const transcriptContainer = el('div', { className: 'sumvid-transcript-container' });
    const emptyState = el('div', { className: 'sumvid-empty' }, [
      el('div', { className: 'sumvid-empty-icon', textContent: '\u{1F4C4}' }),
      el('div', { textContent: msg('btnGetTranscript') }),
    ]);
    transcriptContainer.appendChild(emptyState);
    body.appendChild(transcriptContainer);

    // Status
    body.appendChild(el('div', { className: 'sumvid-status', textContent: msg('statusReady') }));

    panel.appendChild(body);
    return panel;
  }

  /**
   * Render transcript segments safely (no innerHTML)
   */
  function renderTranscript(container, segments) {
    container.textContent = '';

    if (!segments || segments.length === 0) {
      container.appendChild(el('div', { className: 'sumvid-empty' }, [
        el('div', { className: 'sumvid-empty-icon', textContent: '\u{1F4C4}' }),
        el('div', { textContent: msg('transcriptEmpty') }),
      ]));
      return;
    }

    const transcriptDiv = el('div', { className: 'sumvid-transcript' });
    for (const seg of segments) {
      const timeEl = el('span', {
        className: 'sumvid-segment-time',
        textContent: seg.timestamp,
        'data-time': String(parseTimestamp(seg.timestamp)),
      });
      const textEl = el('span', { className: 'sumvid-segment-text', textContent: seg.text });
      transcriptDiv.appendChild(el('div', { className: 'sumvid-segment' }, [timeEl, textEl]));
    }
    container.appendChild(transcriptDiv);
  }

  function parseTimestamp(ts) {
    const clean = ts.replace(/\s/g, '');
    const parts = clean.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  function seekTo(seconds) {
    const video = document.querySelector('video');
    if (video) {
      video.currentTime = seconds;
      video.play().catch(() => {});
    }
  }

  function setStatus(panel, message, isError = false) {
    const statusEl = panel.querySelector('.sumvid-status');
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.classList.toggle('error', isError);
    }
  }

  function setButtonsEnabled(panel, enabled) {
    const btns = panel.querySelectorAll('[data-action="send-ai"], [data-action="copy"]');
    for (const btn of btns) {
      if (enabled) {
        btn.removeAttribute('disabled');
      } else {
        btn.setAttribute('disabled', 'true');
      }
    }
  }

  /**
   * Get template prompt via background script (no fetch+regex)
   */
  async function getTemplatePrompt(templateId) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'SUMVID_GET_TEMPLATE', id: templateId }, (response) => {
        if (response?.success) {
          resolve(response.prompt);
        } else {
          resolve(`Please summarize the following video transcript.\n\nVideo URL: {{VIDEO_URL}}\nTitle: {{TITLE}}\n\nTranscript:\n{{TRANSCRIPT}}`);
        }
      });
    });
  }

  function escapeMarkdown(str) {
    return (str || '').replace(/([#*_|`\[\]()\\~>+-])/g, '\\$1');
  }

  function fillTemplate(prompt, data) {
    // Wrap transcript in code fence to prevent prompt injection
    const safeTranscript = data.transcript
      ? '```transcript\n' + data.transcript.replace(/```/g, '` ` `') + '\n```'
      : '';

    return prompt
      .replace(/\{\{VIDEO_URL\}\}/g, data.url || '')
      .replace(/\{\{TRANSCRIPT\}\}/g, safeTranscript)
      .replace(/\{\{TITLE\}\}/g, escapeMarkdown(data.title))
      .replace(/\{\{CHANNEL\}\}/g, escapeMarkdown(data.channel))
      .replace(/\{\{DURATION\}\}/g, data.duration || '')
      .replace(/\{\{DATE\}\}/g, data.date || '');
  }

  /**
   * AI service-specific prompt optimization wrappers
   */
  const AI_PROMPT_WRAPPERS = {
    gemini: {
      prefix: '',
      suffix: '\n\n---\n注意: 回答は必ず日本語で。Web検索が可能な場合は最新情報を検証に活用してください。',
    },
    chatgpt: {
      prefix: '',
      suffix: '\n\n---\nPlease respond entirely in Japanese (日本語). Use markdown formatting for clear structure.',
    },
    claude: {
      prefix: '<context>\nYouTube動画の文字起こしデータを分析してください。\n</context>\n\n',
      suffix: '\n\n<instructions>\n- 回答は全て日本語で出力\n- タイムスタンプは文字起こし内の実際の時刻をそのまま引用\n- 推測や捏造のタイムスタンプは絶対に使用しない\n- 構造化されたマークダウンで出力\n</instructions>',
    },
    grok: {
      prefix: '',
      suffix: '\n\n---\n注意: 回答は必ず日本語で。リアルタイム検索が利用可能な場合は事実検証に活用してください。マークダウンで構造化して出力してください。',
    },
  };

  async function generatePromptText(targetService) {
    const templatePrompt = await getTemplatePrompt(panelState.activeTemplate);
    const data = {
      ...panelState.metadata,
      transcript: panelState.transcript,
    };

    // Apply includeMetadata setting
    if (!panelState.settings.includeMetadata) {
      data.title = '';
      data.channel = '';
      data.duration = '';
      data.date = '';
    }

    let prompt = fillTemplate(templatePrompt, data);

    // Apply AI service-specific optimization
    const wrapper = AI_PROMPT_WRAPPERS[targetService];
    if (wrapper) {
      prompt = (wrapper.prefix || '') + prompt + (wrapper.suffix || '');
    }

    return prompt;
  }

  function setupEventListeners(panel) {
    // Header toggle
    const header = panel.querySelector('.sumvid-header');
    header.addEventListener('click', () => {
      panelState.collapsed = !panelState.collapsed;
      panel.classList.toggle('collapsed', panelState.collapsed);
      const toggleBtn = panel.querySelector('.sumvid-toggle-btn');
      toggleBtn.setAttribute('aria-label',
        panelState.collapsed ? msg('panelExpand') : msg('panelCollapse')
      );
      header.setAttribute('aria-expanded', String(!panelState.collapsed));
    });

    // Template selector
    const templateSelect = panel.querySelector('.sumvid-template-select');
    templateSelect.addEventListener('change', (e) => {
      panelState.activeTemplate = e.target.value;
      chrome.storage.sync.set({ activeTemplate: panelState.activeTemplate }).catch(() => {});
    });

    // Action buttons (delegated)
    panel.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.hasAttribute('disabled')) return;

      const action = btn.dataset.action;
      if (action === 'get-transcript') {
        await handleGetTranscript(panel);
      } else if (action === 'copy') {
        await handleCopy(panel);
      } else if (action === 'send-ai') {
        await handleSendToAI(panel, btn.dataset.service);
      }
    });

    // Timestamp click for video seeking
    panel.addEventListener('click', (e) => {
      const timeEl = e.target.closest('.sumvid-segment-time');
      if (timeEl) {
        e.stopPropagation();
        seekTo(Number(timeEl.dataset.time));
      }
    });
  }

  async function handleGetTranscript(panel) {
    if (panelState.loading) return;
    panelState.loading = true;

    const btn = panel.querySelector('[data-action="get-transcript"]');
    const originalText = btn.textContent;

    // Show spinner safely
    btn.textContent = '';
    const spinner = el('span', { className: 'sumvid-spinner' });
    btn.appendChild(spinner);
    btn.appendChild(document.createTextNode(msg('statusLoading')));
    btn.setAttribute('disabled', 'true');
    setStatus(panel, msg('statusLoading'));

    try {
      if (!window.__sumvid) {
        throw new Error('EXTRACTOR_NOT_LOADED');
      }

      const segments = await window.__sumvid.getTranscript();
      const metadata = window.__sumvid.getVideoMetadata();
      const includeTs = panelState.settings.showTimestamps;
      const transcript = window.__sumvid.formatTranscript(segments, includeTs);

      panelState.segments = segments;
      panelState.metadata = metadata;
      panelState.transcript = transcript;

      const container = panel.querySelector('.sumvid-transcript-container');
      renderTranscript(container, segments);
      setButtonsEnabled(panel, true);
      setStatus(panel, `${segments.length} segments`);

      // Auto-send to default AI service after transcript extraction
      const defaultAI = panelState.settings.defaultAI || 'gemini';
      if (AI_SERVICES[defaultAI]) {
        setTimeout(() => handleSendToAI(panel, defaultAI), 300);
      }
    } catch (error) {
      const errorKey = error.message === 'TRANSCRIPT_PANEL_NOT_FOUND'
        ? 'errorNoTranscript'
        : 'errorGeneric';
      setStatus(panel, msg(errorKey, [error.message]), true);
    } finally {
      btn.textContent = originalText;
      btn.removeAttribute('disabled');
      panelState.loading = false;
    }
  }

  async function handleCopy(panel) {
    if (!panelState.transcript) return;

    try {
      const defaultAI = panelState.settings.defaultAI || 'gemini';
      const promptText = await generatePromptText(defaultAI);
      await navigator.clipboard.writeText(promptText);
      setStatus(panel, msg('statusCopied'));
    } catch {
      const defaultAI = panelState.settings.defaultAI || 'gemini';
      chrome.runtime.sendMessage({
        type: 'SUMVID_CLIPBOARD_COPY',
        text: await generatePromptText(defaultAI),
      }, (response) => {
        if (response?.success) {
          setStatus(panel, msg('statusCopied'));
        } else {
          setStatus(panel, msg('errorGeneric', ['Clipboard access denied']), true);
        }
      });
    }
  }

  async function handleSendToAI(panel, serviceKey) {
    if (!panelState.transcript) return;

    const service = AI_SERVICES[serviceKey];
    if (!service) return;

    setStatus(panel, `${service.name} に送信中...`);

    try {
      const promptText = await generatePromptText(serviceKey);

      // Copy to clipboard (best effort)
      try {
        await navigator.clipboard.writeText(promptText);
      } catch {
        chrome.runtime.sendMessage({ type: 'SUMVID_CLIPBOARD_COPY', text: promptText });
      }

      // Open AI service - fire and forget, don't block on response
      chrome.runtime.sendMessage({
        type: 'SUMVID_OPEN_AI',
        serviceUrl: service.url,
        text: promptText,
      });

      setStatus(panel, `${service.name} にタブを開きました`);
    } catch (error) {
      setStatus(panel, msg('errorGeneric', [error.message]), true);
    }
  }

  /**
   * Load user settings from storage
   */
  function loadSettings() {
    chrome.storage.sync.get(['activeTemplate', 'settings'], (result) => {
      if (result.activeTemplate) {
        panelState.activeTemplate = result.activeTemplate;
      }
      if (result.settings) {
        panelState.settings = { ...panelState.settings, ...result.settings };
      }
    });
  }

  /**
   * Inject the panel into YouTube's sidebar
   */
  function injectPanel() {
    if (document.getElementById('sumvid-panel')) return;
    if (!window.location.pathname.startsWith('/watch')) return;

    const sidebar = document.querySelector('#secondary-inner')
      || document.querySelector('#secondary')
      || document.querySelector('ytd-watch-flexy #secondary');

    if (!sidebar) return;

    const panel = createPanel();
    setupEventListeners(panel);
    sidebar.insertBefore(panel, sidebar.firstChild);

    // Apply saved template preference
    const select = panel.querySelector('.sumvid-template-select');
    if (select && panelState.activeTemplate) {
      select.value = panelState.activeTemplate;
    }

    // Auto-open if enabled
    if (panelState.settings.panelAutoOpen) {
      handleGetTranscript(panel);
    }
  }

  function removePanel() {
    const panel = document.getElementById('sumvid-panel');
    if (panel) panel.remove();
    panelState.segments = null;
    panelState.transcript = null;
    panelState.metadata = null;
    panelState.loading = false;
  }

  /**
   * Initialize: use yt-navigate-finish event for SPA navigation (replaces MutationObserver)
   */
  function init() {
    loadSettings();

    // YouTube fires this event on SPA navigation completion
    window.addEventListener('yt-navigate-finish', () => {
      removePanel();
      if (window.location.pathname.startsWith('/watch')) {
        // Delay to ensure sidebar is rendered
        setTimeout(injectPanel, 800);
      }
    });

    // Initial load (page may already be a video page)
    if (window.location.pathname.startsWith('/watch')) {
      const MAX_SIDEBAR_RETRIES = 20; // 10 seconds max
      let sidebarRetries = 0;
      const checkSidebar = () => {
        if (sidebarRetries++ > MAX_SIDEBAR_RETRIES) return;
        const sidebar = document.querySelector('#secondary-inner, #secondary');
        if (sidebar) {
          injectPanel();
        } else {
          setTimeout(checkSidebar, 500);
        }
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkSidebar);
      } else {
        checkSidebar();
      }
    }
  }

  init();
})();
