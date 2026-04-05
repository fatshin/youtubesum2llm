# SumVid Privacy Policy

**Last Updated: April 2026**

## Overview

SumVid is a browser extension that extracts video transcripts and helps users send them to AI services for analysis. We are committed to protecting your privacy.

## Data Collection

**SumVid does NOT collect, store, or transmit any personal data.**

### What SumVid accesses:
- **Video transcripts**: Extracted directly from the video page's existing subtitle/caption data in your browser. This data is never sent to our servers.
- **Video metadata**: Title, channel name, duration, and publish date are read from the video page to enhance AI prompts. This data stays in your browser.
- **User preferences**: Your settings (prompt templates, default AI service, display preferences) are stored locally in your browser using Chrome's Storage API (chrome.storage.sync). This data syncs across your Chrome browsers via your Google account — we never access it.

### What SumVid does NOT access:
- Your browsing history
- Your personal information
- Your Google account data
- Video content (audio/video streams)
- Any data from websites other than YouTube and the supported AI services

## Data Sharing

SumVid does not share any data with third parties.

When you choose to send a transcript to an AI service (ChatGPT, Gemini, or Claude), the transcript text is placed in your clipboard or directly into the AI service's input field. This interaction is between you and the AI service — SumVid does not act as an intermediary.

## Third-Party Services

SumVid integrates with the following third-party AI services at your explicit request:
- **ChatGPT** (OpenAI) — https://chatgpt.com
- **Gemini** (Google) — https://gemini.google.com
- **Claude** (Anthropic) — https://claude.ai

Your use of these services is governed by their respective privacy policies. SumVid does not have access to your accounts on these services.

## Permissions

SumVid requests the following browser permissions:
- **activeTab**: To interact with the current YouTube tab
- **scripting**: To extract transcript data from video pages
- **storage**: To save your preferences locally
- **clipboardWrite**: To copy transcript text to your clipboard

## Data Retention

SumVid does not retain any data beyond your browser session. Your preferences are stored in Chrome's sync storage and can be cleared by removing the extension.

## Children's Privacy

SumVid does not knowingly collect data from children under 13. The extension does not collect any personal data from any user.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be reflected in the "Last Updated" date above.

## Open Source

SumVid is open source. You can review the complete source code to verify our privacy practices.

## Contact

For privacy questions or concerns, please open an issue on our GitHub repository.
