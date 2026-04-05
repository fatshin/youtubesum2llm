/**
 * SumVid - Transcript Extractor
 * Extracts transcripts from YouTube video pages with robust selector fallbacks.
 * Injected as content script on youtube.com.
 */

(() => {
  'use strict';

  // Selector definitions (inlined to avoid module import issues in content scripts)
  const TRANSCRIPT_BUTTON_SELECTORS = [
    'ytd-video-description-transcript-section-renderer button',
    '#primary-button ytd-button-renderer button',
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

  const TRANSCRIPT_PANEL_SELECTORS = [
    '#segments-container',
    'ytd-transcript-renderer #segments-container',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
  ];

  const VIDEO_METADATA_SELECTORS = {
    title: [
      'h1.ytd-watch-metadata yt-formatted-string',
      'h1.ytd-video-primary-info-renderer',
      '#title h1 yt-formatted-string',
    ],
    channel: [
      'ytd-channel-name yt-formatted-string a',
      '#channel-name a',
      '#owner-name a',
    ],
    date: [
      '#info-strings yt-formatted-string',
      'ytd-video-primary-info-renderer #info-strings yt-formatted-string',
    ],
    duration: [
      'span.ytp-time-duration',
      '.ytp-time-duration',
    ],
  };

  /**
   * Try multiple selectors, return first match
   */
  function queryFirst(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch { /* skip */ }
    }
    return null;
  }

  /**
   * Wait for an element using MutationObserver (efficient, no rAF polling)
   */
  function waitForElement(selectors, timeout = 10000) {
    return new Promise((resolve) => {
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

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  /**
   * Extract video metadata from the page
   */
  function getVideoMetadata() {
    const getText = (selectors) => {
      const el = queryFirst(selectors);
      if (!el) return '';
      // Handle meta tags
      if (el.tagName === 'META') return el.getAttribute('content') || '';
      return el.textContent?.trim() || '';
    };

    return {
      title: getText(VIDEO_METADATA_SELECTORS.title)
        || document.querySelector('meta[property="og:title"]')?.content
        || document.title.replace(' - YouTube', ''),
      channel: getText(VIDEO_METADATA_SELECTORS.channel)
        || document.querySelector('link[itemprop="name"]')?.content
        || '',
      date: getText(VIDEO_METADATA_SELECTORS.date)
        || document.querySelector('meta[itemprop="datePublished"]')?.content
        || '',
      duration: getText(VIDEO_METADATA_SELECTORS.duration) || '',
      url: window.location.href,
    };
  }

  /**
   * Click the transcript button to open the transcript panel
   */
  async function openTranscriptPanel() {
    // Check if panel is already open
    const existingPanel = queryFirst(TRANSCRIPT_PANEL_SELECTORS);
    if (existingPanel && existingPanel.children.length > 0) {
      return existingPanel;
    }

    // Step 1: Expand description ("...more") if collapsed
    // The transcript button may be hidden until description is expanded
    const expandBtn = document.querySelector('#description-inline-expander #expand')
      || document.querySelector('tp-yt-paper-button#expand')
      || document.querySelector('#expand');
    if (expandBtn && expandBtn.offsetParent !== null) {
      expandBtn.click();
      await new Promise(r => setTimeout(r, 500));
    }

    // Step 2: Try to find and click the transcript button
    const descButton = queryFirst(TRANSCRIPT_BUTTON_SELECTORS);
    if (descButton) {
      descButton.click();
      await new Promise(r => setTimeout(r, 2000));
    } else {
      // Try the "..." menu approach
      const moreButton = document.querySelector('#button-shape button[aria-label="More actions"]')
        || document.querySelector('#button-shape button[aria-label="その他の操作"]');
      if (moreButton) {
        moreButton.click();
        await new Promise(r => setTimeout(r, 500));
        // Look for transcript option in the menu
        const menuItems = document.querySelectorAll('tp-yt-paper-listbox ytd-menu-service-item-renderer');
        for (const item of menuItems) {
          const text = item.textContent?.toLowerCase() || '';
          if (text.includes('transcript') || text.includes('文字起こし')) {
            item.click();
            await new Promise(r => setTimeout(r, 2000));
            break;
          }
        }
      }
    }

    // Wait for the panel to appear
    return waitForElement(TRANSCRIPT_PANEL_SELECTORS, 8000);
  }

  /**
   * Extract transcript segments from the panel
   */
  function extractSegments(panel) {
    const segmentRenderers = panel.querySelectorAll('ytd-transcript-segment-renderer');
    if (segmentRenderers.length === 0) return [];

    return Array.from(segmentRenderers)
      .map(segment => {
        const timestampEl = segment.querySelector('.segment-timestamp')
          || segment.querySelector('[class*="timestamp"]')
          || segment.querySelector('.segment-start-offset');
        const textEl = segment.querySelector('.segment-text')
          || segment.querySelector('[class*="segment-text"]');

        const timestamp = timestampEl?.textContent?.trim() || '';
        const text = textEl?.textContent?.trim() || '';

        if (!text) return null;
        return { timestamp, text };
      })
      .filter(Boolean);
  }

  /**
   * Parse timestamp string to seconds
   */
  function parseTimestamp(ts) {
    const clean = ts.replace(/\s/g, '');
    const parts = clean.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  /**
   * Main transcript extraction function
   */
  async function getTranscript() {
    const panel = await openTranscriptPanel();
    if (!panel) {
      throw new Error('TRANSCRIPT_PANEL_NOT_FOUND');
    }

    // Small delay for content to fully render
    await new Promise(r => setTimeout(r, 500));

    const segments = extractSegments(panel);
    if (segments.length === 0) {
      throw new Error('TRANSCRIPT_EMPTY');
    }

    return segments;
  }

  /**
   * Format segments as text with timestamps
   */
  function formatTranscript(segments, includeTimestamps = true) {
    return segments
      .map(s => includeTimestamps ? `[${s.timestamp}] ${s.text}` : s.text)
      .join('\n');
  }

  // Expose API on window for panel and message handler access
  window.__sumvid = {
    getTranscript,
    getVideoMetadata,
    formatTranscript,
    parseTimestamp,
    extractSegments,
    openTranscriptPanel,
  };

  // Message handler for popup/background communication
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === 'SUMVID_GET_TRANSCRIPT') {
      (async () => {
        try {
          const segments = await getTranscript();
          const metadata = getVideoMetadata();
          const transcript = formatTranscript(segments, request.includeTimestamps !== false);

          sendResponse({
            success: true,
            transcript,
            segments,
            metadata,
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error.message,
          });
        }
      })();
      return true; // Keep channel open for async response
    }

    if (request.type === 'SUMVID_GET_METADATA') {
      sendResponse({
        success: true,
        metadata: getVideoMetadata(),
      });
      return false;
    }
  });
})();
