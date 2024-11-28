import { defaultPrompt } from './prompt-template.js';

document.addEventListener('DOMContentLoaded', function() {
  const getTranscriptButton = document.getElementById('getTranscript');
  const sendToChatGPTButton = document.getElementById('sendToChatGPT');
  const togglePromptButton = document.getElementById('togglePrompt');
  const promptEditor = document.getElementById('promptEditor');
  const promptContainer = document.getElementById('promptContainer');
  const savePromptButton = document.getElementById('savePrompt');
  const resetPromptButton = document.getElementById('resetPrompt');
  const statusDiv = document.getElementById('status');
  const sendToGeminiButton = document.getElementById('sendToGemini');
  const sendToClaudeButton = document.getElementById('sendToClaude');
  const overlay = document.getElementById('overlay');

  // プロンプトの保存と読み込み
  async function loadPromptTemplate() {
    const result = await chrome.storage.local.get('promptTemplate');
    return result.promptTemplate || defaultPrompt;
  }

  async function savePromptTemplate(template) {
    await chrome.storage.local.set({ promptTemplate: template });
    showStatus('プロンプトを保存しました', false);
  }

  // プロンプトエディタの初期化
  async function initPromptEditor() {
    const template = await loadPromptTemplate();
    promptEditor.value = template;
    promptContainer.classList.remove('visible');
    overlay.classList.remove('visible');
  }

  // プロンプトエディタの表示/非表示を切り替え
  togglePromptButton.addEventListener('click', () => {
    document.body.classList.add('editing');
    promptContainer.classList.add('visible');
    overlay.classList.add('visible');
  });

  // オーバーレイをクリックして閉じる
  overlay.addEventListener('click', () => {
    document.body.classList.remove('editing');
    promptContainer.classList.remove('visible');
    overlay.classList.remove('visible');
  });

  // 保存ボタンを押して閉じる
  savePromptButton.addEventListener('click', async () => {
    await savePromptTemplate(promptEditor.value);
    document.body.classList.remove('editing');
    promptContainer.classList.remove('visible');
    overlay.classList.remove('visible');
  });

  // リセットボタンのイベントリスナー
  resetPromptButton.addEventListener('click', async () => {
    promptEditor.value = defaultPrompt;
    await savePromptTemplate(defaultPrompt);
    showStatus('プロンプトをリセットしました', false);
    document.body.classList.remove('editing');
    promptContainer.classList.remove('visible');
    overlay.classList.remove('visible');
  });

  // プロンプトを生成
  async function generatePrompt(transcript) {
    try {
      const template = await loadPromptTemplate();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const videoUrl = tab.url;
      
      return template
        .replace('{{TRANSCRIPT}}', transcript)
        .replace('{{VIDEO_URL}}', videoUrl || '');
    } catch (error) {
      console.error('プロンプト生成エラー:', error);
      throw error;
    }
  }

  // ステータス表示関数
  function showStatus(message, isError = false) {
    statusDiv.textContent = message;
    statusDiv.style.color = isError ? 'red' : '#666';
  }

  // 文字起こし取得の共通処理
  async function getTranscript(withPrompt = false) {
    try {
      // 現在のタブを取得
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        throw new Error('アクティブなタブが見つかりません');
      }

      // YouTubeのURLかチェック
      if (!tab.url?.includes('youtube.com/watch')) {
        throw new Error('YouTubeの動画ページで実行してください');
      }

      // content script を注入
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
      } catch (error) {
        console.log('content script の注入をスキップ:', error);
      }

      // 少し待機して content script の初期化を待つ
      await new Promise(resolve => setTimeout(resolve, 1000));

      // メッセージを送信して応答を待つ
      return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { 
          type: 'GET_TRANSCRIPT',
          withPrompt: withPrompt
        }, response => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          
          if (!response) {
            reject(new Error('応答が空です'));
            return;
          }
          
          if (!response.success) {
            reject(new Error(response.error || '文字起こしの取得に失敗しました'));
            return;
          }
          
          resolve(response);
        });
      });
    } catch (error) {
      console.error('文字起こし取得エラー:', error);
      throw error;
    }
  }

  // 各ボタンのイベントハンドラを修正
  // 文字起こしをコピーボタンの処理
  getTranscriptButton.addEventListener('click', async () => {
    try {
      showStatus('文字起こしを取得中...');
      const response = await getTranscript(false);
      
      // バックグラウンドスクリプト経由でコピー
      chrome.runtime.sendMessage(
        { 
          type: 'COPY_TO_CLIPBOARD', 
          text: response.text
        },
        response => {
          if (response && response.success) {
            showStatus('文字起こしをコピーしました');
          } else {
            showStatus('コピーに失敗しました: ' + (response?.error || '不明なエラー'), true);
          }
        }
      );
    } catch (error) {
      console.error('エラー:', error);
      showStatus(error.message, true);
    }
  });

  // ChatGPT、Gemini、Claudeボタンの共通処理
  async function handleAIService(serviceName, serviceUrl) {
    try {
      showStatus('文字起こしを取得中...');
      const response = await getTranscript(false);

      if (!response.success || !response.text) {
        throw new Error('文字起こしの取得に失敗しました');
      }

      // カスタムプロンプトを生成
      const customPrompt = await generatePrompt(response.text);

      // バックグラウンドスクリプト経由でコピー
      chrome.runtime.sendMessage(
        { type: 'COPY_TO_CLIPBOARD', text: customPrompt },
        async response => {
          if (response && response.success) {
            // AIサービスのページを開く
            const tab = await chrome.tabs.create({ 
              url: serviceUrl,
              active: true
            });

            // ページの読み込みを待つ
            await new Promise(resolve => setTimeout(resolve, 5000));

            try {
              await chrome.tabs.sendMessage(tab.id, {
                type: 'PASTE_TRANSCRIPT',
                text: customPrompt
              });
              showStatus(`${serviceName}に文字起こしを送信しました`);
            } catch (error) {
              showStatus(`テキストをクリップボードにコピーしました。\n手動でペーストしてください。`);
            }
          } else {
            showStatus('コピーに失敗しました: ' + (response?.error || '不明なエラー'), true);
          }
        }
      );
    } catch (error) {
      console.error('エラー:', error);
      showStatus(error.message, true);
    }
  }

  // 各AIサービスのボタンハンドラ
  sendToChatGPTButton.addEventListener('click', () => 
    handleAIService('ChatGPT', 'https://chat.openai.com/'));

  sendToGeminiButton.addEventListener('click', () => 
    handleAIService('Gemini', 'https://gemini.google.com/app'));

  sendToClaudeButton.addEventListener('click', () => 
    handleAIService('Claude', 'https://claude.ai'));

  // 初期化時にプロンプトエディタを表示状態にする
  promptContainer.style.display = 'block';
  promptEditor.style.display = 'block';
  initPromptEditor();
  showStatus('準備完了');
}); 