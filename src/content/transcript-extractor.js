/**
 * SumVid - Transcript Extractor
 * Uses YouTube's InnerTube Captions API to fetch transcript data directly.
 *
 * IMPORTANT: Chrome extension content scripts run in an "isolated world"
 * and CANNOT access window.ytInitialPlayerResponse directly.
 * We solve this by:
 *   1. Injecting a script into the page's MAIN world to read the variable
 *   2. Parsing script tags in the HTML as fallback
 *   3. DOM scraping as last resort
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
   * Strategy 1: Inject script into MAIN world to read ytInitialPlayerResponse
   * Content scripts can't access page JS variables, so we inject a <script>
   * that reads the variable and posts it back via a DOM element.
   */
  function getCaptionUrlFromMainWorld() {
    return new Promise((resolve) => {
      const dataEl = document.createElement('div');
      dataEl.id = '__sumvid_caption_data';
      dataEl.style.display = 'none';
      document.body.appendChild(dataEl);

      const script = document.createElement('script');
      script.textContent = `
        (function() {
          try {
            var el = document.getElementById('__sumvid_caption_data');
            var pr = window.ytInitialPlayerResponse;
            if (pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer) {
              var tracks = pr.captions.playerCaptionsTracklistRenderer.captionTracks || [];
              el.setAttribute('data-tracks', JSON.stringify(tracks));
            } else {
              // Try ytplayer.config
              var cfg = window.ytplayer && window.ytplayer.config;
              if (cfg && cfg.args && cfg.args.raw_player_response) {
                var pr2 = cfg.args.raw_player_response;
                if (pr2.captions && pr2.captions.playerCaptionsTracklistRenderer) {
                  var tracks2 = pr2.captions.playerCaptionsTracklistRenderer.captionTracks || [];
                  el.setAttribute('data-tracks', JSON.stringify(tracks2));
                }
              }
            }
          } catch(e) {
            el.setAttribute('data-error', e.message);
          }
        })();
      `;
      document.body.appendChild(script);

      // Read result synchronously (script runs immediately in main world)
      setTimeout(() => {
        try {
          const tracksJson = dataEl.getAttribute('data-tracks');
          if (tracksJson) {
            const tracks = JSON.parse(tracksJson);
            if (tracks.length > 0) {
              const asrTrack = tracks.find(t => t.kind === 'asr');
              const track = asrTrack || tracks[0];
              resolve(track.baseUrl);
              return;
            }
          }
        } catch {}
        resolve(null);

        // Cleanup
        dataEl.remove();
        script.remove();
      }, 100);
    });
  }

  /**
   * Strategy 2: Parse caption URLs from HTML script tags
   */
  function getCaptionUrlFromScriptTags() {
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        if (!text.includes('captionTracks')) continue;

        // Match the captionTracks array in ytInitialPlayerResponse
        const match = text.match(/"captionTracks"\s*:\s*(\[[\s\S]*?\])\s*,\s*"audioTracks"/);
        if (match) {
          const tracks = JSON.parse(match[1]);
          if (tracks.length > 0) {
            const asrTrack = tracks.find(t => t.kind === 'asr');
            const track = asrTrack || tracks[0];
            return track.baseUrl;
          }
        }

        // Alternative: simpler regex
        const match2 = text.match(/"baseUrl"\s*:\s*"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/);
        if (match2) {
          return match2[1].replace(/\\u0026/g, '&');
        }
      }
    } catch {}
    return null;
  }

  /**
   * Fetch transcript JSON from YouTube's timedtext API
   */
  async function fetchTranscriptFromAPI(captionUrl) {
    const url = captionUrl + '&fmt=json3';
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Transcript fetch failed: ${response.status}`);

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
   * Strategy 3: DOM scraping fallback
   */
  async function fetchTranscriptFromDOM() {
    const expandBtn = document.querySelector('#description-inline-expander #expand');
    if (expandBtn && expandBtn.offsetParent !== null) {
      expandBtn.click();
      await new Promise(r => setTimeout(r, 500));
    }

    const buttonSelectors = [
      'ytd-video-description-transcript-section-renderer button',
      'button[aria-label="Show transcript"]',
      'button[aria-label="文字起こしを表示"]',
    ];
    for (const sel of buttonSelectors) {
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
        const timestamp = ts?.textContent?.trim() || '';
        const text = txt?.textContent?.trim() || '';
        return text ? { timestamp, text } : null;
      }).filter(Boolean);
    }

    const legacy = panel.querySelectorAll('ytd-transcript-segment-renderer');
    if (legacy.length > 0) {
      return Array.from(legacy).map(seg => {
        const ts = seg.querySelector('.segment-timestamp');
        const txt = seg.querySelector('.segment-text');
        return (txt?.textContent?.trim()) ? { timestamp: ts?.textContent?.trim() || '', text: txt.textContent.trim() } : null;
      }).filter(Boolean);
    }

    return [];
  }

  /**
   * Main extraction: API (main world inject → script tag parse) → DOM fallback
   */
  async function getTranscript() {
    // Strategy 1: Inject into main world to get caption URL
    let captionUrl = await getCaptionUrlFromMainWorld();

    // Strategy 2: Parse from script tags
    if (!captionUrl) {
      captionUrl = getCaptionUrlFromScriptTags();
    }

    // Fetch via API if we have a URL
    if (captionUrl) {
      try {
        const segments = await fetchTranscriptFromAPI(captionUrl);
        if (segments.length > 0) return segments;
      } catch (e) {
        console.warn('SumVid: API fetch failed, trying DOM', e);
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
