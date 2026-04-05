/**
 * SumVid - Transcript Extractor
 *
 * CRITICAL: Content scripts run in Chrome's ISOLATED WORLD.
 * They CANNOT access window.ytInitialPlayerResponse.
 * YouTube's CSP blocks inline <script> injection.
 *
 * Solution: Parse the raw HTML of <script> tags to find captionTracks,
 * then fetch transcript via YouTube's timedtext JSON API.
 */

(() => {
  'use strict';

  const VIDEO_METADATA_SELECTORS = {
    title: ['h1.ytd-watch-metadata yt-formatted-string', '#title h1 yt-formatted-string'],
    channel: ['ytd-channel-name yt-formatted-string a', '#channel-name a'],
    date: ['#info-strings yt-formatted-string'],
    duration: ['span.ytp-time-duration'],
  };

  function queryFirst(selectors, root = document) {
    for (const sel of selectors) {
      try { const el = root.querySelector(sel); if (el) return el; } catch {}
    }
    return null;
  }

  function getVideoMetadata() {
    const getText = (sels) => {
      const el = queryFirst(sels);
      if (!el) return '';
      return el.tagName === 'META' ? (el.getAttribute('content') || '') : (el.textContent?.trim() || '');
    };
    return {
      title: getText(VIDEO_METADATA_SELECTORS.title)
        || document.querySelector('meta[property="og:title"]')?.content
        || document.title.replace(' - YouTube', ''),
      channel: getText(VIDEO_METADATA_SELECTORS.channel)
        || document.querySelector('link[itemprop="name"]')?.content || '',
      date: getText(VIDEO_METADATA_SELECTORS.date)
        || document.querySelector('meta[itemprop="datePublished"]')?.content || '',
      duration: getText(VIDEO_METADATA_SELECTORS.duration) || '',
      url: window.location.href,
    };
  }

  /**
   * Extract caption track URL by parsing ALL <script> tags in the page.
   * This works in the isolated world because we're reading DOM text content,
   * not accessing JS variables.
   */
  function getCaptionUrlFromHTML() {
    const html = document.documentElement.innerHTML;

    // Method 1: Find timedtext URL directly (most reliable)
    // YouTube embeds URLs like: "baseUrl":"https://www.youtube.com/api/timedtext?v=..."
    const timedtextMatch = html.match(
      /"baseUrl"\s*:\s*"(https?:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/
    );
    if (timedtextMatch) {
      // Decode unicode escapes (\u0026 -> &)
      return timedtextMatch[1]
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/');
    }

    // Method 2: Try to find captionTracks array and parse first baseUrl
    const captionTracksMatch = html.match(/"captionTracks"\s*:\s*\[([\s\S]*?)\]/);
    if (captionTracksMatch) {
      const trackMatch = captionTracksMatch[1].match(/"baseUrl"\s*:\s*"([^"]+)"/);
      if (trackMatch) {
        return trackMatch[1]
          .replace(/\\u0026/g, '&')
          .replace(/\\\//g, '/');
      }
    }

    return null;
  }

  /**
   * For SPA navigation: try to get caption URL from the network by
   * fetching the page HTML directly
   */
  async function getCaptionUrlFromFetch() {
    try {
      const videoId = new URL(window.location.href).searchParams.get('v');
      if (!videoId) return null;

      const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        credentials: 'include',
      });
      const html = await resp.text();

      const match = html.match(
        /"baseUrl"\s*:\s*"(https?:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/
      );
      if (match) {
        return match[1]
          .replace(/\\u0026/g, '&')
          .replace(/\\\//g, '/');
      }
    } catch {}
    return null;
  }

  /**
   * Fetch transcript JSON from YouTube's timedtext API
   */
  async function fetchTranscriptFromAPI(captionUrl) {
    // Use json3 format for structured JSON
    const url = captionUrl + '&fmt=json3';
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Transcript API error: ${response.status}`);

    const data = await response.json();
    const events = data.events || [];
    const segments = [];

    for (const event of events) {
      if (!event.segs) continue;
      const startMs = event.tStartMs || 0;
      const text = event.segs.map(s => s.utf8 || '').join('').trim();
      if (!text || text === '\n') continue;

      const totalSec = Math.floor(startMs / 1000);
      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      const timestamp = hours > 0
        ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
        : `${mins}:${String(secs).padStart(2, '0')}`;

      segments.push({ timestamp, text });
    }
    return segments;
  }

  /**
   * DOM scraping fallback
   */
  async function fetchTranscriptFromDOM() {
    const expandBtn = document.querySelector('#description-inline-expander #expand');
    if (expandBtn && expandBtn.offsetParent !== null) {
      expandBtn.click();
      await new Promise(r => setTimeout(r, 500));
    }

    for (const sel of [
      'ytd-video-description-transcript-section-renderer button',
      'button[aria-label="Show transcript"]',
      'button[aria-label="文字起こしを表示"]',
    ]) {
      const btn = document.querySelector(sel);
      if (btn) { btn.click(); await new Promise(r => setTimeout(r, 3000)); break; }
    }

    await new Promise(r => setTimeout(r, 1000));

    const panel = document.querySelector('[target-id="PAmodern_transcript_view"]')
      || document.querySelector('[target-id="engagement-panel-searchable-transcript"]');
    if (!panel) return [];

    const modern = panel.querySelectorAll('transcript-segment-view-model');
    if (modern.length > 0) {
      return Array.from(modern).map(seg => {
        const ts = seg.querySelector('.ytwTranscriptSegmentViewModelTimestamp');
        const txt = seg.querySelector('span.yt-core-attributed-string');
        const text = txt?.textContent?.trim() || '';
        return text ? { timestamp: ts?.textContent?.trim() || '', text } : null;
      }).filter(Boolean);
    }

    return [];
  }

  /**
   * Main: HTML parse → re-fetch page → DOM fallback
   */
  async function getTranscript() {
    // Strategy 1: Parse caption URL from current page HTML
    let captionUrl = getCaptionUrlFromHTML();

    // Strategy 2: Re-fetch the page HTML (handles SPA navigation)
    if (!captionUrl) {
      captionUrl = await getCaptionUrlFromFetch();
    }

    // Use API if we have a caption URL
    if (captionUrl) {
      try {
        const segments = await fetchTranscriptFromAPI(captionUrl);
        if (segments.length > 0) return segments;
      } catch (e) {
        console.warn('SumVid: API failed, trying DOM fallback', e);
      }
    }

    // Strategy 3: DOM fallback
    const domSegments = await fetchTranscriptFromDOM();
    if (domSegments.length > 0) return domSegments;

    throw new Error('TRANSCRIPT_EMPTY');
  }

  function parseTimestamp(ts) {
    const parts = ts.replace(/\s/g, '').split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  function formatTranscript(segments, includeTimestamps = true) {
    return segments.map(s => includeTimestamps ? `[${s.timestamp}] ${s.text}` : s.text).join('\n');
  }

  window.__sumvid = { getTranscript, getVideoMetadata, formatTranscript, parseTimestamp };

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === 'SUMVID_GET_TRANSCRIPT') {
      (async () => {
        try {
          const segments = await getTranscript();
          const metadata = getVideoMetadata();
          const transcript = formatTranscript(segments, request.includeTimestamps !== false);
          sendResponse({ success: true, transcript, segments, metadata });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
      })();
      return true;
    }
    if (request.type === 'SUMVID_GET_METADATA') {
      sendResponse({ success: true, metadata: getVideoMetadata() });
      return false;
    }
  });
})();
