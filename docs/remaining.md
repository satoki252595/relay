# 残タスク (2026-09-23 時点)

このファイルが正です。終わったら消すこと。

## 審査提出 (build 3 で提出。iPhone 専用化・掲載情報刷新)

- [x] APNs キー発行 (Key ID U8ZYLB4JZV、.p8 は ~/.private)・App ID に Push・App Store プロファイル再生成
- [x] build 2 upload (b501514) → VALID、審査対象バージョン 1.0 に紐づけ済み
- [x] 実機 iPhone 16e (iOS 26.6.1) で接続・通知トークン登録・APNs 送信 (200) を確認
- [x] 審査動画 `~/relay-evidence/build2/relay-review-build2.mp4`、審査メモ `~/relay-evidence/build2/review-notes.txt`
- [x] プライバシーポリシー URL を設定 (GitHub の ops/legal/privacy-policy.md)
- [x] 審査連絡先入力
- [ ] build 3 (iPhone 専用・アプリ内の「VM実行(有料)準備中」表記削除) upload → 選択
- [ ] ストア掲載: スクショ4枚 (6.9")・説明文/キーワード/プロモーション刷新・プレビュー動画
- [ ] TestFlight build 3 を実機に導入し、人の操作で審査動画を撮影 → complete stage preflight → 審査メモ・動画差し替え
- [ ] 提出 (提出直前に人の最終確認)

## 後片付け

- [ ] 実験 repo `relay-e2e-01` (private) を削除
  (`gh auth refresh -s delete_repo` 後に `gh repo delete`)

## 動作未検証

- [ ] codex ハーネスの実ジョブ検証 (2026-09-23 再確認も利用枠切れ、回復は 2026-10-12 12:59 以降。回復後に相談モードで一言テスト)
  ※ 前回の中断は stdin 待ち (`Reading additional input from stdin...`) が原因だった可能性が高い。
  stdin を閉じて起動するよう修正済み (2026-09-23)
- [ ] VM 実行 (提供準備中。ユーザー検討中のため未着手)

## orca 比較で見つけた UIUX 差分

参考: https://github.com/stablyai/orca (Electron + React Native。QR ペアリングコード→LAN直結/クラウドリレーの候補レース→キーチェーン保存、完了 push 通知あり)

- [ ] **完了通知の実機検証**: 実装済み (APNs 直送+タップ遷移)。
  残り: (a) APNs キー発行 (人手・ポータル) (b) App ID に Push 能力付与 (人手) (c) プロファイル再生成→build 2
  アップロード→バックグラウンド受信検証

## 堅牢性・仕上げ

- [ ] muse の途中危険操作ゲートは事後検出のみ (`muse exec --json` が実行前のコマンドを流さないため、
  `tool.result` の command で検出して以降を止める)。実行前に止める手段があれば置き換える
- [ ] 英語ローカライズ (1.0 は日本語のみで提出。了承済み)

## 対応済み (記録)

- QR スキャンペアリング (C-5): `@capacitor/barcode-scanner` (Apple Vision) で Mac アプリのペアリング QR を読み取り、
  URL・トークンを入れて接続診断つきで接続。NSCameraUsageDescription 追加 (2026-09-23)
- APNs のネイティブ配線漏れを修正: `aps-environment` entitlement と AppDelegate のトークン転送が無く、
  build 1 ではデバイストークン登録が完了しない状態だった。build 番号を 2 に (2026-09-23)
- 接続診断 (C-1): 接続時に URL 形式→到達性→Relay サーバーか→トークンを順に判定し、
  チェックリストと確認ポイントを表示 (`public/diagnose.js`)。ブラウザで各経路を確認済み (2026-09-23)
- 応答テキストのノイズ除去 (C-3): stderr・hook 応答 `{}`・プロンプト反響・thinking・部分出力と確定文の重複を除去。
  各ハーネスのイベントを skip/delta/message/result/tool に正規化。子プロセスの stdin を閉じ、
  codex resume に `--json` を付与。cursor/codex/muse のツール実行も途中ゲートの検出対象に (2026-09-23)
- ハーネス無応答時の保護 (C-2): 無出力が `HARNESS_IDLE_TIMEOUT_MS` (既定10分) 続いたら kill して error 化。
  中断・承認待ち・タイムアウト後の close で注記が上書きされる既存不具合も併せて修正 (2026-09-23)
- APNs 完了通知の実装をコミット (実機検証は上記の人手作業待ち) (2026-09-23)
- 相談モードの cursor-agent 起動失敗 → `--trust` 付与で修正 (2026-09-22)
- iOS 実機でキーボードがコンポーザーを隠す → 高さ 100% 化で修正 (2026-09-22)
- 料金体系 (ローカル無料/VM準備中)、GitHub 接続表示、OS 別セットアップ (2026-09-21)
