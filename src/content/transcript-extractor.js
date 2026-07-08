/**
 * SumVid - Transcript Extractor
 *
 * YouTube (2025/2026) locked down both caption endpoints:
 *   - /api/timedtext → HTTP 200 + empty body without PoToken
 *   - /youtubei/v1/get_transcript → 400 FAILED_PRECONDITION for anonymous
 *     requests, and even SAPISIDHASH-signed requests are inconsistent.
 *
 * Strategy order (DOM first — most reliable):
 *   1. DOM scraping: trigger YouTube's own "Show transcript" flow and
 *      read the rendered segments. Their authenticated player JS owns
 *      the request; we just harvest the result.
 *   2. InnerTube get_transcript (only if SAPISID cookie present): used
 *      as a fast-path fallback for signed-in users. Skipped silently
 *      when the user is not signed in, since it always 400s.
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

  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return hours > 0
      ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${mins}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * Parse InnerTube config from the current page HTML.
   * Returns { params, clientVersion, visitorData, hl, gl } or null if unusable.
   */
  function parseInnerTubeConfig(html) {
    const paramsMatch = html.match(
      /"getTranscriptEndpoint"\s*:\s*\{[^}]*?"params"\s*:\s*"([^"]+)"/
    );
    if (!paramsMatch) return null;

    const pick = (key, fallback) => {
      const m = html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
      return m ? m[1] : fallback;
    };

    return {
      params: paramsMatch[1],
      clientVersion: pick('INNERTUBE_CLIENT_VERSION', '2.20250101.00.00'),
      visitorData: pick('VISITOR_DATA', pick('visitorData')),
      hl: pick('INNERTUBE_CONTEXT_HL', 'en'),
      gl: pick('INNERTUBE_CONTEXT_GL', 'US'),
    };
  }

  /**
   * Fetch the watch page HTML for a given video id (used when the current
   * DOM doesn't yet have the transcript params, e.g. SPA navigation).
   */
  async function fetchWatchPageHTML() {
    const videoId = new URL(window.location.href).searchParams.get('v');
    if (!videoId) return '';
    try {
      const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        credentials: 'include',
      });
      return await resp.text();
    } catch (e) {
      console.warn('SumVid: watch page re-fetch failed', e);
      return '';
    }
  }

  /**
   * Walk the InnerTube response shape and extract transcript segments.
   */
  function extractSegmentsFromInnerTubeResponse(data) {
    const actions = data?.actions || [];
    let initialSegments = null;
    for (const action of actions) {
      const seg = action?.updateEngagementPanelAction?.content
        ?.transcriptRenderer?.content
        ?.transcriptSearchPanelRenderer?.body
        ?.transcriptSegmentListRenderer?.initialSegments;
      if (seg) { initialSegments = seg; break; }
    }
    if (!initialSegments) return [];

    const results = [];
    for (const s of initialSegments) {
      const seg = s.transcriptSegmentRenderer;
      if (!seg) continue;
      const startMs = Number(seg.startMs) || 0;
      const runs = seg.snippet?.runs;
      const text = Array.isArray(runs)
        ? runs.map(r => r.text || '').join('')
        : (seg.snippet?.simpleText || '');
      const trimmed = text.trim();
      if (!trimmed) continue;
      results.push({ timestamp: formatTime(startMs), text: trimmed });
    }
    return results;
  }

  /**
   * Read a cookie value by name (returns '' if missing).
   * SAPISID / __Secure-3PAPISID are NOT HttpOnly on youtube.com, so
   * content scripts can read them.
   */
  function getCookie(name) {
    const match = document.cookie.match(
      new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)')
    );
    return match ? match[1] : '';
  }

  /**
   * Compute YouTube's SAPISIDHASH authorization header value.
   * Format: `<timestamp>_<sha1(timestamp SPACE sapisid SPACE origin)>`
   */
  async function computeSapisidHash(sapisid, origin = 'https://www.youtube.com') {
    const ts = Math.floor(Date.now() / 1000).toString();
    const payload = `${ts} ${sapisid} ${origin}`;
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(payload));
    const hex = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return `${ts}_${hex}`;
  }

  /**
   * Build Authorization header for InnerTube requests if the user is
   * signed in. Returns null for anonymous sessions.
   */
  async function buildAuthorizationHeader() {
    const sapisid =
      getCookie('SAPISID') ||
      getCookie('__Secure-3PAPISID') ||
      getCookie('__Secure-1PAPISID');
    if (!sapisid) return null;
    const hash = await computeSapisidHash(sapisid);
    return `SAPISIDHASH ${hash}`;
  }

  /**
   * Call `/youtubei/v1/get_transcript`. Adds SAPISIDHASH authorization
   * when the user is signed in, which is now required by the endpoint.
   */
  async function fetchTranscriptViaInnerTube(cfg) {
    const body = {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: cfg.clientVersion,
          hl: cfg.hl,
          gl: cfg.gl,
          ...(cfg.visitorData ? { visitorData: cfg.visitorData } : {}),
        },
      },
      params: cfg.params,
    };

    const headers = {
      'Content-Type': 'application/json',
      'X-Origin': 'https://www.youtube.com',
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': cfg.clientVersion,
    };
    if (cfg.visitorData) headers['X-Goog-Visitor-Id'] = cfg.visitorData;

    const auth = await buildAuthorizationHeader();
    if (auth) {
      headers['Authorization'] = auth;
      console.log('SumVid: InnerTube using SAPISIDHASH auth');
    } else {
      console.log('SumVid: InnerTube anonymous (no SAPISID cookie)');
    }

    const response = await fetch(
      'https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false',
      {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(body),
      }
    );

    console.log(`SumVid: InnerTube response: status=${response.status}`);
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`InnerTube ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    return extractSegmentsFromInnerTubeResponse(data);
  }

  /**
   * Find the transcript panel (already open or not)
   */
  function findTranscriptPanel() {
    // First: check for panels that contain transcript segments directly
    const panelSelectors = [
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
      '[target-id="engagement-panel-searchable-transcript"]',
      'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
      '[target-id="PAmodern_transcript_view"]',
      // Consolidated timeline view (tabs: タイムライン/チャプター/文字起こし)
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-timeline-view-consolidated"]',
      '[target-id="engagement-panel-timeline-view-consolidated"]',
    ];
    for (const sel of panelSelectors) {
      const panel = document.querySelector(sel);
      if (panel && panel.offsetParent !== null) {
        // Check if this panel actually has transcript segments
        const hasSegments = panel.querySelector('transcript-segment-view-model, ytd-transcript-segment-renderer');
        if (hasSegments) return panel;
      }
    }
    // Fallback: any visible panel with transcript segments
    const allPanels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
    for (const panel of allPanels) {
      if (panel.offsetParent !== null && panel.querySelector('transcript-segment-view-model, ytd-transcript-segment-renderer')) {
        console.log('SumVid: found transcript panel via segment detection');
        return panel;
      }
    }
    return null;
  }

  /**
   * Scrape transcript segments from the visible panel
   */
  /**
   * Extract {timestamp, text} from a single transcript segment element.
   * Uses textContent rather than specific child selectors so it survives
   * YouTube's frequent class-name churn.
   */
  function parseSegmentElement(seg) {
    // Collapse whitespace to make pattern matching reliable.
    const full = (seg.textContent || '').replace(/\s+/g, ' ').trim();
    if (!full) return null;

    // Shape of textContent is always "<timestamp> <caption text>",
    // e.g. "0:42 こんにちは" or "1:02:15 hello world".
    const m = full.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+([\s\S]+)$/);
    if (m) return { timestamp: m[1], text: m[2].trim() };

    // Fallback: textContent didn't start with a timestamp — probably
    // the segment is just captions without timestamp. Try to find a
    // timestamp element separately.
    const tsEl = seg.querySelector(
      '[class*="Timestamp" i], [class*="timestamp" i], [aria-label*=":"]'
    );
    const ts = tsEl?.textContent?.trim() || '';
    return { timestamp: ts, text: full };
  }

  function scrapeTranscriptSegments(panel) {
    // Modern (transcript-segment-view-model) + legacy (ytd-transcript-segment-renderer).
    const segs = panel.querySelectorAll(
      'transcript-segment-view-model, ytd-transcript-segment-renderer'
    );
    if (segs.length > 0) {
      console.log(`SumVid: found ${segs.length} transcript segment elements`);
      const out = [];
      for (const seg of segs) {
        const parsed = parseSegmentElement(seg);
        if (parsed && parsed.text) out.push(parsed);
      }
      if (out.length > 0) return out;
      console.log('SumVid: segments present but textContent parse yielded 0');
    }

    // Generic fallback: scan any element whose text looks like "HH:MM text".
    const allSegments = panel.querySelectorAll('[class*="segment"], [class*="transcript"]');
    if (allSegments.length > 0) {
      const results = [];
      for (const seg of allSegments) {
        const parsed = parseSegmentElement(seg);
        if (parsed && parsed.timestamp && parsed.text) results.push(parsed);
      }
      if (results.length > 0) {
        console.log(`SumVid: generic fallback produced ${results.length} segments`);
        return results;
      }
    }

    return [];
  }

  /**
   * DOM scraping fallback: check if panel is already open, or open it
   */
  /**
   * Click the 文字起こし tab in the consolidated timeline panel if needed
   */
  async function clickTranscriptTab() {
    // Look for chip/tab buttons containing "文字起こし" or "Transcript"
    const chips = document.querySelectorAll(
      'ytd-engagement-panel-section-list-renderer yt-chip-cloud-chip-renderer, ' +
      'ytd-engagement-panel-section-list-renderer [class*="chip"]'
    );
    for (const chip of chips) {
      const text = chip.textContent?.trim() || '';
      if (text === '文字起こし' || text === 'Transcript' || text === 'Transkript') {
        console.log('SumVid: clicking transcript tab:', text);
        chip.click();
        await new Promise(r => setTimeout(r, 1500));
        return true;
      }
    }
    return false;
  }

  /**
   * Poll for segments to appear inside a panel, up to `timeoutMs`.
   * Returns segments when found or [] on timeout.
   */
  async function waitForSegments(timeoutMs = 6000, pollMs = 250) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const panel = findTranscriptPanel();
      if (panel) {
        const segs = scrapeTranscriptSegments(panel);
        if (segs.length > 0) return segs;
      }
      await new Promise(r => setTimeout(r, pollMs));
    }
    return [];
  }

  /**
   * Find a "Show transcript" button by scanning aria-labels and visible
   * button text. YouTube localizes these strings heavily.
   */
  function findTranscriptButton() {
    const labels = [
      'show transcript', 'open transcript', 'transcript',
      '文字起こしを表示', '文字起こし',
      'transkript anzeigen', 'transkript',
      'afficher la transcription', 'transcription',
      'mostrar transcripción', 'transcripción',
      '显示转写', '显示字幕',
      '자막', '스크립트',
    ];
    const matches = (s) => {
      const t = (s || '').toLowerCase().trim();
      return labels.some(l => t === l || t.includes(l));
    };
    // Scan description area + any button with matching aria-label/text
    const candidates = document.querySelectorAll(
      'ytd-video-description-transcript-section-renderer button, ' +
      'button[aria-label], tp-yt-paper-button[aria-label]'
    );
    for (const btn of candidates) {
      if (btn.offsetParent === null) continue;
      const aria = btn.getAttribute('aria-label') || '';
      if (matches(aria) || matches(btn.textContent)) return btn;
    }
    return null;
  }

  async function fetchTranscriptFromDOM() {
    // Step 1: panel already open? If so, just scrape.
    let panel = findTranscriptPanel();
    if (panel) {
      console.log('SumVid: transcript panel already open');
      const segments = scrapeTranscriptSegments(panel);
      if (segments.length > 0) return segments;
      // Panel open but empty — maybe wrong tab. Click the transcript chip.
      await clickTranscriptTab();
      const retry = await waitForSegments(4000);
      if (retry.length > 0) return retry;
    }

    // Step 2: Expand description so transcript button becomes visible.
    const expandBtn = document.querySelector('#description-inline-expander #expand');
    if (expandBtn && expandBtn.offsetParent !== null) {
      expandBtn.click();
      await new Promise(r => setTimeout(r, 400));
    }

    // Step 3: Click transcript button
    const btn = findTranscriptButton();
    if (!btn) {
      console.log('SumVid: no transcript button found');
      return [];
    }
    console.log('SumVid: clicking transcript button:', btn.getAttribute('aria-label') || btn.textContent?.trim());
    btn.click();

    // Step 4: Wait up to 8s for segments to render (covers slow networks
    // and lazily-loaded consolidated timeline panels).
    let segments = await waitForSegments(8000);
    if (segments.length > 0) return segments;

    // Step 5: If a consolidated timeline panel opened, click the
    // transcript chip inside it and wait again.
    await clickTranscriptTab();
    segments = await waitForSegments(5000);
    if (segments.length > 0) return segments;

    console.log('SumVid: DOM scraping exhausted, no segments');
    return [];
  }

  /**
   * Returns true iff a SAPISID cookie is present. When absent the
   * InnerTube endpoint always returns 400 FAILED_PRECONDITION, so we
   * skip it entirely to avoid log noise.
   */
  function hasSapisid() {
    return !!(
      getCookie('SAPISID') ||
      getCookie('__Secure-3PAPISID') ||
      getCookie('__Secure-1PAPISID')
    );
  }

  /**
   * Try InnerTube with a given page HTML source. Returns segments or [].
   * Uses console.log (not warn) so chrome://extensions doesn't flag
   * expected fallback paths as errors.
   */
  async function tryInnerTube(html, label) {
    const cfg = parseInnerTubeConfig(html);
    if (!cfg) {
      console.log(`SumVid: ${label} — no getTranscriptEndpoint params`);
      return [];
    }
    try {
      const segments = await fetchTranscriptViaInnerTube(cfg);
      if (segments.length > 0) {
        console.log(`SumVid: ${label} succeeded, ${segments.length} segments`);
        return segments;
      }
      console.log(`SumVid: ${label} returned 0 segments`);
    } catch (e) {
      console.log(`SumVid: ${label} failed (fallback will run):`, e.message);
    }
    return [];
  }

  /**
   * Main extraction pipeline (DOM-first):
   *   1. DOM scraping — YouTube's own "Show transcript" flow + harvest
   *   2. InnerTube get_transcript (only for signed-in users, as fallback)
   */
  async function getTranscript() {
    // Strategy 1: DOM scraping — most reliable across account states.
    console.log('SumVid: Strategy 1 (DOM scraping)');
    const domSegments = await fetchTranscriptFromDOM();
    if (domSegments.length > 0) {
      console.log(`SumVid: Strategy 1 succeeded, ${domSegments.length} segments`);
      return domSegments;
    }

    // Strategy 2 & 3: InnerTube API path — only useful when signed in.
    if (hasSapisid()) {
      const s2 = await tryInnerTube(
        document.documentElement.innerHTML,
        'Strategy 2 (InnerTube/DOM)'
      );
      if (s2.length > 0) return s2;

      const freshHtml = await fetchWatchPageHTML();
      if (freshHtml) {
        const s3 = await tryInnerTube(
          freshHtml,
          'Strategy 3 (InnerTube/fresh fetch)'
        );
        if (s3.length > 0) return s3;
      }
    } else {
      console.log('SumVid: skipping InnerTube (not signed in)');
    }

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
