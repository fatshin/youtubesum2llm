/**
 * SumVid - DOM Selector Definitions
 * Centralized selector management for YouTube and AI services.
 * Priority: structural selectors > aria-label > data attributes
 */

// YouTube transcript button selectors (multi-language fallback)
export const TRANSCRIPT_BUTTON_SELECTORS = [
  // Structural (most stable)
  'ytd-video-description-transcript-section-renderer button',
  '#primary-button ytd-button-renderer button',
  // Engagement panel trigger
  'button.ytd-transcript-search-panel-renderer',
  // aria-label variants (language-dependent)
  'button[aria-label="Show transcript"]',
  'button[aria-label="Open transcript"]',
  'button[aria-label="文字起こしを表示"]',
  'button[aria-label="Transkript anzeigen"]',
  'button[aria-label="Afficher la transcription"]',
  'button[aria-label="Mostrar transcripción"]',
  'button[aria-label="Mostrar transcrição"]',
  'button[aria-label="자막 표시"]',
  'button[aria-label="显示转录稿"]',
  'button[aria-label="顯示逐字稿"]',
];

// YouTube transcript segment selectors (modern first, legacy fallback)
export const TRANSCRIPT_SEGMENT_SELECTORS = [
  // Modern YouTube (2025+)
  'transcript-segment-view-model',
  // Legacy YouTube
  'ytd-transcript-segment-renderer',
];

export const TRANSCRIPT_TIMESTAMP_SELECTORS = [
  // Modern YouTube (2025+)
  '.ytwTranscriptSegmentViewModelTimestamp',
  // Legacy YouTube
  '.segment-timestamp',
  '[class*="timestamp"]',
];

export const TRANSCRIPT_TEXT_SELECTORS = [
  // Modern YouTube (2025+)
  'span.yt-core-attributed-string',
  'yt-attributed-string span',
  // Legacy YouTube
  '.segment-text',
  '[class*="segment-text"]',
];

// YouTube transcript panel (modern first, legacy fallback)
export const TRANSCRIPT_PANEL_SELECTORS = [
  // Modern YouTube (2025+)
  'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
  // Legacy YouTube
  'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
  '#segments-container',
];

// YouTube video metadata selectors
export const VIDEO_METADATA_SELECTORS = {
  title: [
    'h1.ytd-watch-metadata yt-formatted-string',
    'h1.ytd-video-primary-info-renderer',
    '#title h1 yt-formatted-string',
    'meta[property="og:title"]',
  ],
  channel: [
    'ytd-channel-name yt-formatted-string a',
    '#channel-name a',
    '#owner-name a',
    'meta[itemprop="author"]',
  ],
  date: [
    '#info-strings yt-formatted-string',
    'ytd-video-primary-info-renderer #info-strings yt-formatted-string',
    'meta[itemprop="datePublished"]',
  ],
  duration: [
    'span.ytp-time-duration',
    '.ytp-time-duration',
  ],
  description: [
    '#description-inline-expander yt-attributed-string span',
    'ytd-text-inline-expander span',
  ],
};

// YouTube subtitle language selector
export const SUBTITLE_LANGUAGE_SELECTORS = [
  'ytd-transcript-renderer #footer tp-yt-paper-listbox',
  '.ytd-transcript-footer-renderer tp-yt-paper-listbox',
];

// AI service input field selectors (ordered by specificity)
export const AI_INPUT_SELECTORS = {
  'chat.openai.com': [
    '#prompt-textarea',
    'textarea[data-id="root"]',
    'div[contenteditable="true"][data-placeholder]',
    '[contenteditable="true"]',
  ],
  'chatgpt.com': [
    '#prompt-textarea',
    'textarea[data-id="root"]',
    'div[contenteditable="true"][data-placeholder]',
    '[contenteditable="true"]',
  ],
  'gemini.google.com': [
    'rich-textarea [contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"][aria-label]',
    '[contenteditable="true"]',
  ],
  'claude.ai': [
    '[contenteditable="true"].ProseMirror',
    'div.ProseMirror[contenteditable="true"]',
    'fieldset [contenteditable="true"]',
    '[contenteditable="true"]',
  ],
};

// AI service submit button selectors
export const AI_SUBMIT_SELECTORS = {
  'chat.openai.com': [
    'button[data-testid="send-button"]',
    'form button[type="submit"]',
  ],
  'chatgpt.com': [
    'button[data-testid="send-button"]',
    'form button[type="submit"]',
  ],
  'gemini.google.com': [
    'button[aria-label="Send message"]',
    'button.send-button',
  ],
  'claude.ai': [
    'button[aria-label="Send Message"]',
    'button[type="submit"]',
  ],
};

// AI service URLs
export const AI_SERVICE_URLS = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app',
  claude: 'https://claude.ai/new',
};

// AI service display names
export const AI_SERVICE_NAMES = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
};

/**
 * Try multiple selectors and return the first match
 * @param {string[]} selectors - Array of CSS selectors to try
 * @param {Element} root - Root element to search within (default: document)
 * @returns {Element|null}
 */
export function queryFirst(selectors, root = document) {
  for (const selector of selectors) {
    try {
      const el = root.querySelector(selector);
      if (el) return el;
    } catch {
      // Skip invalid selectors
    }
  }
  return null;
}

/**
 * Try multiple selectors and return all matches
 * @param {string[]} selectors - Array of CSS selectors to try
 * @param {Element} root - Root element to search within (default: document)
 * @returns {Element[]}
 */
export function queryAll(selectors, root = document) {
  for (const selector of selectors) {
    try {
      const els = root.querySelectorAll(selector);
      if (els.length > 0) return Array.from(els);
    } catch {
      // Skip invalid selectors
    }
  }
  return [];
}
