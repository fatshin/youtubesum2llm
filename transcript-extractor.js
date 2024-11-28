class TranscriptExtractor {
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

  static addPrompt(transcript, videoUrl) {
    const prompt = `以下は YouTube 動画の自動文字起こしの内容です。
動画URL: ${videoUrl}

以下の手順で処理してください：

1. まず、明らかな誤字・脱字を修正してください。特に以下の点に注意してください：
   - 句読点の適切な配置
   - 同音異義語の修正
   - 文脈に合わない単語の修正
   - 不自然な改行の修正
   - 時間を残して下さい

2. 修正後の内容について：
   - 重要なポイントを100点以内で箇条書きでまとめてください
   - 言及している内容を後で追えるように、発言されている時間を言及している箇所に記載してください
   - 全体の要約を5行程度で書いてください

文字起こしの内容：
${transcript}

メタ認知、水平思考で偏らず、要約して下さい`;
    return prompt;
  }

  static async getTranscriptWithPrompt() {
    const transcript = await this.getTranscript();
    return this.addPrompt(transcript);
  }
}

// グローバルスコープで利用可能にする
window.TranscriptExtractor = TranscriptExtractor; 