/**
 * SumVid - Background Service Worker
 * Handles message routing, clipboard operations, tab management, and template serving.
 */

/**
 * Load templates on demand (Service Worker can sleep and lose in-memory state)
 */
async function loadTemplates() {
  try {
    const resp = await fetch(chrome.runtime.getURL('src/lib/prompt-templates.json'));
    return await resp.json();
  } catch (e) {
    console.error('SumVid: failed to load templates', e);
    return {};
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // Always reset defaults on install/update to ensure gemini is default
  chrome.storage.sync.set({
    activeTemplate: 'summary',
    settings: {
      defaultAI: 'gemini',
      panelAutoOpen: false,
      showTimestamps: true,
      includeMetadata: true,
    },
  });
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
            autoSubmit: true,
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
      copyToClipboard(request.text).catch(() => {});
      openAIServiceAndPaste(request.serviceUrl, request.text).then((result) => {
        sendResponse(result);
      });
      return true;
    }

    case 'SUMVID_GET_TEMPLATE': {
      const templateId = request.id;
      // Check custom templates first, then load built-in on demand
      chrome.storage.sync.get('promptTemplates', (result) => {
        const customs = result.promptTemplates || {};
        const stored = customs[templateId];

        if (typeof stored === 'string') {
          sendResponse({ success: true, prompt: stored });
          return;
        }
        if (stored?.prompt) {
          sendResponse({ success: true, prompt: stored.prompt });
          return;
        }

        // Load built-in templates fresh every time (Service Worker may have slept)
        loadTemplates().then(templates => {
          const builtin = templates[templateId];
          if (builtin) {
            sendResponse({ success: true, prompt: builtin.prompt });
          } else {
            sendResponse({ success: false, error: 'TEMPLATE_NOT_FOUND' });
          }
        });
      });
      return true;
    }

    case 'SUMVID_GET_ALL_TEMPLATES': {
      loadTemplates().then(templates => {
        sendResponse({ success: true, templates });
      });
      return true;
    }
  }
});
