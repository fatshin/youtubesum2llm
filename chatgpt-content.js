console.log('ChatGPT content script loaded');

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    function checkElement() {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('要素が見つかりませんでした: ' + selector));
      } else {
        setTimeout(checkElement, 100);
      }
    }

    checkElement();
  });
}

// クリップボードからテキストを読み取ってペーストする
async function pasteFromClipboard() {
  try {
    const textarea = await waitForElement('#prompt-textarea');
    const clipText = await navigator.clipboard.readText();
    
    // テキストエリアに値を設定
    textarea.value = clipText;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();

    // 送信ボタンを有効化
    const submitButton = textarea.closest('form')?.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = false;
    }

    return true;
  } catch (error) {
    console.error('クリップボードからのペーストエラー:', error);
    return false;
  }
}

// メッセージリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PASTE_TRANSCRIPT') {
    (async () => {
      try {
        console.log('ペースト処理を開始...');
        // ページが完全に読み込まれるまで待機
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // クリップボードからペースト
        const success = await pasteFromClipboard();
        
        if (success) {
          console.log('ペースト処理が成功しました');
          sendResponse({ success: true });
        } else {
          throw new Error('ペーストに失敗しました');
        }
      } catch (error) {
        console.error('ChatGPT入力エラー:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});
 