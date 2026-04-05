/**
 * SumVid - Offscreen Document
 * Handles clipboard operations in MV3 background context.
 */
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type !== 'OFFSCREEN_COPY') return;

  navigator.clipboard.writeText(request.text)
    .then(() => sendResponse({ success: true }))
    .catch((error) => sendResponse({ success: false, error: String(error) }));

  return true;
});
