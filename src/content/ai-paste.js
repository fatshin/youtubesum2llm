/**
 * SumVid - AI Service Auto-Paste
 * Handles automatic pasting of transcript+prompt into AI service input fields.
 * Injected as content script on ChatGPT, Gemini, and Claude pages.
 *
 * Review fixes:
 * - [HIGH] execCommand fallback → DataTransfer paste simulation (Claude)
 * - [HIGH] waitForElement rAF → MutationObserver (Claude)
 */

(() => {
  'use strict';

  const AI_INPUT_SELECTORS = {
    'chat.openai.com': [
      '#prompt-textarea',
      'textarea[data-id="root"]',
      'div[contenteditable="true"][data-placeholder]',
    ],
    'chatgpt.com': [
      '#prompt-textarea',
      'textarea[data-id="root"]',
      'div[contenteditable="true"][data-placeholder]',
    ],
    'gemini.google.com': [
      'rich-textarea [contenteditable="true"]',
      '.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][aria-label]',
    ],
    'claude.ai': [
      '[contenteditable="true"].ProseMirror',
      'div.ProseMirror[contenteditable="true"]',
      'fieldset [contenteditable="true"]',
    ],
  };

  /**
   * Try multiple selectors, return first match
   */
  function queryFirst(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch { /* skip */ }
    }
    return null;
  }

  /**
   * Wait for an element using MutationObserver (efficient, no rAF polling)
   */
  function waitForElement(selectors, timeout = 15000) {
    return new Promise((resolve) => {
      // Check immediately
      const existing = queryFirst(selectors);
      if (existing) { resolve(existing); return; }

      const observer = new MutationObserver(() => {
        const el = queryFirst(selectors);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Timeout safety
      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  /**
   * Insert text into the input element with framework-compatible methods
   */
  function insertText(element, text) {
    // For textarea elements
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      // Use native setter to bypass React's synthetic event system
      const nativeSetter = Object.getOwnPropertyDescriptor(
        element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(element, text);
      } else {
        element.value = text;
      }

      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    // For contenteditable elements
    if (element.isContentEditable) {
      element.focus();

      // Method 1: execCommand insertText (best React/ProseMirror compat)
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);

      const inserted = document.execCommand('insertText', false, text);

      if (inserted) {
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        }));
        return true;
      }

      // Method 2: DataTransfer paste event simulation
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        });
        element.dispatchEvent(pasteEvent);
        return true;
      } catch { /* fallback below */ }

      // Method 3: Direct textContent (last resort)
      element.textContent = text;
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text,
      }));
      return true;
    }

    return false;
  }

  /**
   * Handle paste request from background/popup
   */
  async function handlePasteRequest(text) {
    const host = window.location.hostname;
    const selectors = AI_INPUT_SELECTORS[host];

    if (!selectors) {
      return { success: false, error: 'UNSUPPORTED_SERVICE' };
    }

    const inputEl = await waitForElement(selectors);
    if (!inputEl) {
      return { success: false, error: 'INPUT_NOT_FOUND' };
    }

    // Small delay for page to fully initialize
    await new Promise(r => setTimeout(r, 500));

    const inserted = insertText(inputEl, text);
    return inserted
      ? { success: true }
      : { success: false, error: 'INSERT_FAILED' };
  }

  // Message listener
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === 'SUMVID_PASTE') {
      handlePasteRequest(request.text).then(sendResponse);
      return true;
    }
  });
})();
