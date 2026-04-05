/**
 * SumVid - Internationalization Helper
 * Wraps chrome.i18n for easy message retrieval with fallbacks.
 */

/**
 * Get a localized message
 * @param {string} key - Message key from _locales/*/messages.json
 * @param {string|string[]} [substitutions] - Optional substitution values
 * @returns {string}
 */
export function msg(key, substitutions) {
  try {
    const message = chrome.i18n.getMessage(key, substitutions);
    return message || key;
  } catch {
    return key;
  }
}

/**
 * Get the current UI language
 * @returns {string} - Language code (e.g., 'ja', 'en')
 */
export function getUILanguage() {
  try {
    return chrome.i18n.getUILanguage();
  } catch {
    return 'en';
  }
}

/**
 * Check if the current language is Japanese
 * @returns {boolean}
 */
export function isJapanese() {
  return getUILanguage().startsWith('ja');
}

/**
 * Apply i18n to all elements with data-i18n attribute
 * @param {Element} root - Root element to search within
 */
export function applyI18n(root = document) {
  const elements = root.querySelectorAll('[data-i18n]');
  for (const el of elements) {
    const key = el.getAttribute('data-i18n');
    const attr = el.getAttribute('data-i18n-attr');
    const message = msg(key);

    if (attr) {
      el.setAttribute(attr, message);
    } else {
      el.textContent = message;
    }
  }
}
