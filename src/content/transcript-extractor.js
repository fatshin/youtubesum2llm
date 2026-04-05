/**
 * SumVid - Transcript Extractor
 * Extracts transcripts from YouTube video pages.
 *
 * YouTube has migrated to a "modern transcript view" using Web Components:
 *   - Panel: [target-id="PAmodern_transcript_view"] (replaces #segments-container)
 *   - Segment: <transcript-segment-view-model> (replaces ytd-transcript-segment-renderer)
 *   - Timestamp: .ytwTranscriptSegmentViewModelTimestamp
 *   - Text: span.yt-core-attributed-string inside <transcript-segment-view-model>
 *
 * Legacy selectors are kept as fallbacks for older YouTube versions.
 */

(() => {
  'use strict';

  // --- Transcript button selectors (multi-language) ---
  const TRANSCRIPT_BUTTON_SELECTORS = [
    // Structural (most stable)
    'ytd-video-description-transcript-section-renderer button',
    // aria-label variants
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

  // --- Transcript panel selectors (modern first, legacy fallback) ---
  const TRANSCRIPT_PANEL_SELECTORS = [
    // Modern YouTube (2025+)
    'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
    // Legacy YouTube
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
    '#segments-container',
  ];

  // --- Video metadata selectors ---
  const VIDEO_METADATA_SELECTORS = {
    title: [
      'h1.ytd-watch-metadata yt-formatted-string',
      '#title h1 yt-formatted-string',
      'h1.ytd-video-primary-info-renderer',
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
      } catch { /* skip invalid selectors */ }
    }
    return null;
  }

  /**
   * Wait for an element using MutationObserver
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
   * Open the transcript panel
   */
  async function openTranscriptPanel() {
    // Check if a transcript panel is already open (visible)
    for (const sel of TRANSCRIPT_PANEL_SELECTORS) {
      try {
        const panel = document.querySelector(sel);
        if (panel) {
          const vis = panel.getAttribute('visibility');
          if (vis === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') return panel;
          // For #segments-container (legacy), check children
          if (sel === '#segments-container' && panel.children.length > 0) return panel;
        }
      } catch { /* skip */ }
    }

    // Step 1: Expand description if collapsed (transcript button may be hidden)
    const expandBtn = document.querySelector('#description-inline-expander #expand')
      || document.querySelector('tp-yt-paper-button#expand')
      || document.querySelector('#expand');
    if (expandBtn && expandBtn.offsetParent !== null) {
      expandBtn.click();
      await new Promise(r => setTimeout(r, 500));
    }

    // Step 2: Click the transcript button
    const descButton = queryFirst(TRANSCRIPT_BUTTON_SELECTORS);
    if (descButton) {
      descButton.click();
      await new Promise(r => setTimeout(r, 2500));
    } else {
      // Try "..." menu approach as fallback
      const moreButton = document.querySelector('#button-shape button[aria-label="More actions"]')
        || document.querySelector('#button-shape button[aria-label="その他の操作"]');
      if (moreButton) {
        moreButton.click();
        await new Promise(r => setTimeout(r, 500));
        const menuItems = document.querySelectorAll('tp-yt-paper-listbox ytd-menu-service-item-renderer');
        for (const item of menuItems) {
          const text = item.textContent?.toLowerCase() || '';
          if (text.includes('transcript') || text.includes('文字起こし')) {
            item.click();
            await new Promise(r => setTimeout(r, 2500));
            break;
          }
        }
      }
    }

    // Step 3: Wait for panel to appear
    return waitForElement(TRANSCRIPT_PANEL_SELECTORS, 8000);
  }

  /**
   * Extract transcript segments from the panel.
   * Supports both modern (2025+) and legacy YouTube DOM structures.
   */
  function extractSegments(panel) {
    // === Modern YouTube (2025+) ===
    // Uses <transcript-segment-view-model> custom elements
    const modernSegments = panel.querySelectorAll('transcript-segment-view-model');
    if (modernSegments.length > 0) {
      return Array.from(modernSegments)
        .map(segment => {
          // Timestamp: .ytwTranscriptSegmentViewModelTimestamp
          const timestampEl = segment.querySelector('.ytwTranscriptSegmentViewModelTimestamp');
          // Text: span.yt-core-attributed-string inside the segment
          const textEl = segment.querySelector('span.yt-core-attributed-string')
            || segment.querySelector('yt-attributed-string span')
            || segment.querySelector('yt-formatted-string');

          const timestamp = timestampEl?.textContent?.trim() || '';
          const text = textEl?.textContent?.trim() || '';

          if (!text) return null;
          return { timestamp, text };
        })
        .filter(Boolean);
    }

    // === Legacy YouTube ===
    // Uses <ytd-transcript-segment-renderer> elements
    const legacySegments = panel.querySelectorAll('ytd-transcript-segment-renderer');
    if (legacySegments.length > 0) {
      return Array.from(legacySegments)
        .map(segment => {
          const timestampEl = segment.querySelector('.segment-timestamp')
            || segment.querySelector('[class*="timestamp"]');
          const textEl = segment.querySelector('.segment-text')
            || segment.querySelector('[class*="segment-text"]');

          const timestamp = timestampEl?.textContent?.trim() || '';
          const text = textEl?.textContent?.trim() || '';

          if (!text) return null;
          return { timestamp, text };
        })
        .filter(Boolean);
    }

    // === Fallback: generic text extraction from any child elements ===
    // In case YouTube introduces yet another DOM structure
    const anySegments = [];
    const allTimestamps = panel.querySelectorAll('[class*="Timestamp"], [class*="timestamp"]');
    for (const tsEl of allTimestamps) {
      const parent = tsEl.closest('[class*="Segment"], [class*="segment"], [class*="timeline"]')
        || tsEl.parentElement;
      if (!parent) continue;

      const timestamp = tsEl.textContent?.trim() || '';
      // Skip accessibility labels like "18 秒"
      if (timestamp.includes('秒') || timestamp.includes('sec')) continue;

      // Find text sibling
      const textEl = parent.querySelector('span:not([class*="Timestamp"]):not([class*="timestamp"]):not([class*="A11y"]):not([class*="a11y"])');
      const text = textEl?.textContent?.trim() || '';

      if (text && timestamp) {
        anySegments.push({ timestamp, text });
      }
    }

    return anySegments;
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

    // Wait for segments to render inside the panel
    await new Promise(r => setTimeout(r, 1000));

    let segments = extractSegments(panel);

    // Retry once if empty (panel may still be loading)
    if (segments.length === 0) {
      await new Promise(r => setTimeout(r, 2000));
      segments = extractSegments(panel);
    }

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

  // Expose API on window for panel script access
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
      return true;
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
