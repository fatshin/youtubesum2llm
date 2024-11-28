chrome.runtime.onInstalled.addListener(() => {
  console.log('YouTube 要約アシスタントがインストールされました');
});

// クリップボード操作のためのバックグラウンドスクリプト
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'COPY_TO_CLIPBOARD') {
    // アクティブなタブにメッセージを送信
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'EXECUTE_COPY',
          text: request.text
        }, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse(response);
          }
        });
      } else {
        sendResponse({ success: false, error: 'アクティブなタブが見つかりません' });
      }
    });
    return true;
  }
}); 