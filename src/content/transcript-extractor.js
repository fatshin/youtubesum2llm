/**
 * SumVid - Transcript Extractor
 * Uses YouTube's InnerTube Captions API to fetch transcript data directly.
 * This is far more reliable than DOM scraping, as it doesn't depend on
 * YouTube's frequently-changing UI structure.
 *
 * How it works:
 * 1. Extract caption track URLs from ytInitialPlayerResponse (embedded in page)
 * 2. Fetch the XML transcript directly from YouTube's timedtext API
 * 3. Parse XML into timestamp + text segments
 *
 * Fallback: If API approach fails, attempts DOM scraping as backup.
 */

(() => {
  'use strict';

  // --- Video metadata selectors ---
  const VIDEO_METADATA_SELECTORS = {
    title: [
      'h1.ytd-watch-metadata yt-formatted-string',
      '#title h1 yt-formatted-string',
    ],
    channel: [
      'ytd-channel-name yt-formatted-string a',
      '#channel-name a',
    ],
    date: [
      '#info-strings yt-formatted-string',
    ],
    duration: [
      'span.ytp-time-duration',
    ],
  };

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
   * Get caption track URL from ytInitialPlayerResponse
   * This is embedded in the page's JavaScript and contains direct URLs
   * to YouTube's timedtext API for each available subtitle track.
   */
  function getCaptionTrackUrl() {
    // Method 1: From window.ytInitialPlayerResponse (available on page load)
    const playerResponse = window.ytInitialPlayerResponse;
    if (playerResponse) {
      const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks && tracks.length > 0) {
        // Prefer ASR (auto-generated) track, or first available
        const asrTrack = tracks.find(t => t.kind === 'asr');
        const track = asrTrack || tracks[0];
        return track.baseUrl;
      }
    }

    // Method 2: Parse from page source (for SPA navigation where window var may be stale)
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        if (text.includes('"captionTracks"')) {
          const match = text.match(/"captionTracks":\s*(\[.*?\])/);
          if (match) {
            const tracks = JSON.parse(match[1]);
            if (tracks.length > 0) {
              const asrTrack = tracks.find(t => t.kind === 'asr');
              const track = asrTrack || tracks[0];
              return track.baseUrl;
            }
          }
        }
      }
    } catch { /* ignore parse errors */ }

    return null;
  }

  /**
   * Fetch and parse transcript XML from YouTube's timedtext API
   */
  async function fetchTranscriptFromAPI(captionUrl) {
    // Add fmt=json3 for JSON format, or use default XML
    const url = captionUrl + '&fmt=json3';
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch transcript: ${response.status}`);
    }

    const data = await response.json();
    const events = data.events || [];

    const segments = [];
    for (const event of events) {
      // Skip events without text segments
      if (!event.segs) continue;

      const startMs = event.tStartMs || 0;
      const text = event.segs.map(s => s.utf8 || '').join('').trim();

      if (!text || text === '\n') continue;

      // Convert ms to timestamp string
      const totalSec = Math.floor(startMs / 1000);
      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;

      let timestamp;
      if (hours > 0) {
        timestamp = `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      } else {
        timestamp = `${mins}:${String(secs).padStart(2, '0')}`;
      }

      segments.push({ timestamp, text });
    }

    return segments;
  }

  /**
   * Fallback: DOM-based extraction (for cases where API isn't available)
   */
  async function fetchTranscriptFromDOM() {
    // Try to open transcript panel
    const transcriptButtons = [
      'ytd-video-description-transcript-section-renderer button',
      'button[aria-label="Show transcript"]',
      'button[aria-label="文字起こしを表示"]',
    ];

    // Expand description first
    const expandBtn = document.querySelector('#description-inline-expander #expand');
    if (expandBtn && expandBtn.offsetParent !== null) {
      expandBtn.click();
      await new Promise(r => setTimeout(r, 500));
    }

    for (const sel of transcriptButtons) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        await new Promise(r => setTimeout(r, 3000));
        break;
      }
    }

    // Wait for panel
    await new Promise(r => setTimeout(r, 1000));

    // Try modern YouTube transcript panel
    const panel = document.querySelector('[target-id="PAmodern_transcript_view"]')
      || document.querySelector('[target-id="engagement-panel-searchable-transcript"]');

    if (!panel) return [];

    // Modern: transcript-segment-view-model
    const modernSegments = panel.querySelectorAll('transcript-segment-view-model');
    if (modernSegments.length > 0) {
      return Array.from(modernSegments)
        .map(seg => {
          const ts = seg.querySelector('.ytwTranscriptSegmentViewModelTimestamp');
          const txt = seg.querySelector('span.yt-core-attributed-string');
          const timestamp = ts?.textContent?.trim() || '';
          const text = txt?.textContent?.trim() || '';
          if (!text) return null;
          return { timestamp, text };
        })
        .filter(Boolean);
    }

    // Legacy: ytd-transcript-segment-renderer
    const legacySegments = panel.querySelectorAll('ytd-transcript-segment-renderer');
    if (legacySegments.length > 0) {
      return Array.from(legacySegments)
        .map(seg => {
          const ts = seg.querySelector('.segment-timestamp');
          const txt = seg.querySelector('.segment-text');
          const timestamp = ts?.textContent?.trim() || '';
          const text = txt?.textContent?.trim() || '';
          if (!text) return null;
          return { timestamp, text };
        })
        .filter(Boolean);
    }

    return [];
  }

  /**
   * Main transcript extraction — API first, DOM fallback
   */
  async function getTranscript() {
    // Strategy 1: InnerTube Captions API (most reliable)
    const captionUrl = getCaptionTrackUrl();
    if (captionUrl) {
      try {
        const segments = await fetchTranscriptFromAPI(captionUrl);
        if (segments.length > 0) return segments;
      } catch (error) {
        console.warn('SumVid: API transcript fetch failed, trying DOM fallback', error);
      }
    }

    // Strategy 2: DOM scraping fallback
    const domSegments = await fetchTranscriptFromDOM();
    if (domSegments.length > 0) return domSegments;

    throw new Error('TRANSCRIPT_EMPTY');
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
