/**
 * SumVid - Background Service Worker
 * Handles message routing, clipboard operations, tab management, and template serving.
 */

import templates from '../lib/prompt-templates.json' with { type: 'json' };

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      activeTemplate: 'summary',
      settings: {
        defaultAI: 'claude',
        panelAutoOpen: false,
        showTimestamps: true,
        includeMetadata: true,
      },
    });
  }
});

/**
 * Ensure offscreen document exists for clipboard operations
 */
async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('src/background/offscreen.html');
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'src/background/offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: 'Copy transcript text to clipboard',
    });
  }
}

/**
 * Copy text to clipboard using offscreen document (MV3 best practice)
 */
async function copyToClipboard(text) {
  try {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_COPY',
      text,
    });
    return Boolean(response?.success);
  } catch (error) {
    console.error('SumVid: clipboard copy failed', error);
    return false;
  }
}

/**
 * Open an AI service tab and paste the transcript
 */
async function openAIServiceAndPaste(serviceUrl, text) {
  const tab = await chrome.tabs.create({ url: serviceUrl, active: true });

  return new Promise((resolve) => {
    function onUpdated(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);

        // Delay to let SPA frameworks initialize
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'SUMVID_PASTE',
            text,
          }, (response) => {
            if (chrome.runtime.lastError || !response?.success) {
              resolve({ success: false, fallback: 'clipboard' });
              return;
            }
            resolve({ success: true });
          });
        }, 2000);
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);

    // Timeout safety
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve({ success: false, fallback: 'timeout' });
    }, 30000);
  });
}

/**
 * Get a built-in template prompt by ID
 */
function getBuiltinTemplate(templateId) {
  return templates[templateId] || null;
}

// Central message router
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request.type) {
    case 'SUMVID_CLIPBOARD_COPY': {
      copyToClipboard(request.text).then(success => {
        sendResponse({ success });
      });
      return true;
    }

    case 'SUMVID_OPEN_AI': {
      copyToClipboard(request.text).then(async (copied) => {
        if (!copied) {
          sendResponse({ success: false, error: 'CLIPBOARD_FAILED' });
          return;
        }
        const result = await openAIServiceAndPaste(request.serviceUrl, request.text);
        sendResponse(result);
      });
      return true;
    }

    case 'SUMVID_GET_TEMPLATE': {
      const templateId = request.id;
      // Check custom templates first
      chrome.storage.sync.get('promptTemplates', (result) => {
        const customs = result.promptTemplates || {};
        const stored = customs[templateId];

        // Handle both string and object storage formats
        if (typeof stored === 'string') {
          sendResponse({ success: true, prompt: stored });
          return;
        }
        if (stored?.prompt) {
          sendResponse({ success: true, prompt: stored.prompt });
          return;
        }

        // Fall back to built-in
        const builtin = getBuiltinTemplate(templateId);
        if (builtin) {
          sendResponse({ success: true, prompt: builtin.prompt });
          return;
        }

        sendResponse({ success: false, error: 'TEMPLATE_NOT_FOUND' });
      });
      return true;
    }

    case 'SUMVID_GET_ALL_TEMPLATES': {
      sendResponse({ success: true, templates });
      return false;
    }
  }
});
