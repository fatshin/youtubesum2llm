console.log('content.js が読み込まれました');

// グローバル変数としてTranscriptExtractorを定義
if (typeof window.TranscriptExtractor === 'undefined') {
  window.TranscriptExtractor = class {
    static async getTranscript() {
      try {
        console.log('文字起こし取得を開始...');
        
        // 文字起こしボタンをクリック
        const transcriptButton = document.querySelector('button[aria-label="文字起こしを表示"]');
        console.log('文字起こしボタン:', transcriptButton ? '見つかりました' : '見つかりません');
        
        if (transcriptButton) {
          transcriptButton.click();
          console.log('文字起こしボタンをクリックしました');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // 文字起こしパネルが表示されるのを待つ
        console.log('文字起こしパネルを待機中...');
        const panel = await this.waitForElement('#segments-container');
        console.log('文字起こしパネル:', panel ? '見つかりました' : '見つかりません');

        if (!panel) {
          throw new Error('文字起こしパネルを開けませんでした');
        }

        // 文字起こしの各セグメントを取得
        const segments = panel.querySelectorAll('ytd-transcript-segment-renderer');
        console.log(`文字起こしセグメント数: ${segments.length}`);

        if (!segments.length) {
          throw new Error('文字起こしが見つかりませんでした');
        }

        // 文字起こしテキストを抽出
        console.log('文字起こしテキストの抽出を開始...');
        const transcriptSegments = Array.from(segments)
          .map((segment, index) => {
            const timestampElement = segment.querySelector('.segment-timestamp');
            const textElement = segment.querySelector('.segment-text');
            
            const timestamp = timestampElement?.textContent?.trim() || '';
            const text = textElement?.textContent?.trim() || '';
            
            console.log(`セグメント ${index + 1}:`, { timestamp, text });
            
            if (!text) return null;
            return `[${timestamp}] ${text}`;
          })
          .filter(segment => segment !== null);

        console.log('フィルタリング後のセグメント数:', transcriptSegments.length);

        const transcript = transcriptSegments.join('\n');
        console.log('最終的な文字起こしの長さ:', transcript.length);
        console.log('文字起こしサンプル（最初の300文字）:', transcript.substring(0, 300));

        if (!transcript) {
          throw new Error('文字起こしの内容を取得できませんでした');
        }

        return transcript;

      } catch (error) {
        console.error('文字起こし取得エラーの詳細:', error);
        throw error;
      }
    }

    static async waitForElement(selector, timeout = 10000) {
      console.log(`要素を待機中: ${selector}`);
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        const element = document.querySelector(selector);
        if (element) {
          console.log(`要素が見つかりました: ${selector}`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return element;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      console.log(`要素が見つかりませんでした: ${selector}`);
      return null;
    }

    static async addPrompt(transcript, videoUrl) {
      try {
        const response = await fetch(chrome.runtime.getURL('prompt-template.js'));
        const module = await response.text();
        const template = module.match(/defaultPrompt = `([\s\S]*?)`/)[1];
        
        return template
          .replace('{{VIDEO_URL}}', videoUrl)
          .replace('{{TRANSCRIPT}}', transcript);
      } catch (error) {
        console.error('プロンプトテンプレート読み込みエラー:', error);
        throw error;
      }
    }

    static async getTranscriptWithPrompt(videoUrl) {
      const transcript = await this.getTranscript();
      return this.addPrompt(transcript, videoUrl);
    }
  };
  console.log('TranscriptExtractor が初期化されました');
}

// クリップボードへのコピー関数を改善
async function copyToClipboard(text) {
  try {
    // バックグラウンドスクリプト経由でコピー
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { 
          type: 'COPY_TO_CLIPBOARD', 
          text: text 
        },
        response => {
          if (response && response.success) {
            console.log('バックグラウンドスクリプト経由でコピーに成功しました');
            resolve(true);
          } else {
            console.error('バックグラウンドスクリプト経由でのコピーに失敗:', response?.error);
            reject(new Error(response?.error || 'コピ���に失敗しました'));
          }
        }
      );
    });
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    return false;
  }
}

// メッセージリスナーを設定
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('メッセージを受信:', request);
  
  if (request.type === 'GET_TRANSCRIPT') {
    (async () => {
      try {
        console.log('TranscriptExtractor の状態:', typeof window.TranscriptExtractor);
        if (typeof window.TranscriptExtractor === 'undefined') {
          throw new Error('TranscriptExtractorが定義されていません');
        }
        
        // プロンプト付きの文字起こしを取得
        const text = await window.TranscriptExtractor.getTranscript();
        // URLを取得
        const videoUrl = window.location.href;
        // URLを含めたプロンプトを生成（awaitを追加）
        const promptText = await window.TranscriptExtractor.addPrompt(text, videoUrl);
        console.log('プロンプト付き文字起こしを取得:', promptText.substring(0, 100) + '...');
        
        const success = await copyToClipboard(promptText);
        if (success) {
          console.log('プロンプト付きテキストをクリップボードにコピーしました');
          sendResponse({ 
            success: true, 
            message: 'プロンプト付き文字起こしをコピーしました',
            text: promptText,
            error: null
          });
        } else {
          throw new Error('コピーに失敗しました');
        }
      } catch (error) {
        console.error('詳細なエラー情報:', error);
        sendResponse({ 
          success: false, 
          text: null,
          error: error.message,
          stack: error.stack,
          message: '文字起こしの取得に失敗しました: ' + error.message
        });
      }
    })();
    return true;
  }
});

// メッセージリスナーを設定
chrome.runtime.onMessage.addListener(async function(request, sender, sendResponse) {
  if (request.type === 'PASTE_TRANSCRIPT') {
    try {
      // AIサービスごとの入力欄セレクタ
      const selectors = {
        'chat.openai.com': '#prompt-textarea',
        'gemini.google.com': '[contenteditable="true"]',
        'claude.ai': '[contenteditable="true"]'
      };

      // 現在のホストに基づいてセレクタを選択
      const host = window.location.hostname;
      const selector = selectors[host];

      if (!selector) {
        throw new Error('未対応のサービスです');
      }

      // 入力欄を取得
      const inputElement = await waitForElement(selector);
      
      // テキストを入力
      if (inputElement.isContentEditable) {
        inputElement.textContent = request.text;
        // 入力イベントを発火
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        inputElement.value = request.text;
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Enterキーイベントを発火（自動送信）
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      inputElement.dispatchEvent(enterEvent);

      sendResponse({ success: true });
    } catch (error) {
      console.error('ペースト失敗:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
  return true;
});

// 要素が表示されるまで待機する関数
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    function checkElement() {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error('要素が見つかりませんでした'));
        return;
      }

      requestAnimationFrame(checkElement);
    }

    checkElement();
  });
}

// クリップボード操作のメッセージリスナーを追加
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'EXECUTE_COPY') {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = request.text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      sendResponse({ success: true });
    } catch (error) {
      console.error('コピー失敗:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
}); 