# Relay iOS リリース手順書 (App Store)

`release-ios-app-store` skill の証拠ゲートに沿って進める。
本書は Relay 固有の値・コマンドを固定する。skill 本文の手順が正。

## 0. リリース身元 (固定)

| 項目 | 値 |
|---|---|
| 操作種別 | 初回リリース |
| Bundle ID | `dev.relay.agentchat` (初回 upload 前なら変更可) |
| Team | QVUR5T7J46 |
| Marketing version / Build | 1.0.0 / 1 (`CURRENT_PROJECT_VERSION` ずつ加算) |
| Release method | App Store (`method=app-store-connect`) |
| 言語 | 主: 日本語、副: 英語 |
| 商用 (IAP/サブスク) | なし |
| 暗号化輸出 | `ITSAppUsesNonExemptEncryption=false` 設定済み |
| 年齢審査 | 4+ 想定 (開発者ツール・問題コンテンツなし) |
| App Privacy | Data Not Collected (開発者への送信なし。詳細は `ops/legal/privacy-policy.md`) |

候補コミットは archive 直前に `git rev-parse HEAD` で固定し、
`BUILD_SOURCE_COMMIT` に 40 文字で渡す。
`BuildSourceCommit` キーは Info.plist に配線済み。

## 1. 候補の確定 (自動化済み・再確認)

```sh
cd /Users/satoki252595/projects/relay
npm test                                  # 21/21 緑を確認
node ops/make-ios-assets.mjs              # 念のため再生成
npx cap sync ios                          # public/ → ios 配下へ同期
git status --short                        # 空 (クリーンツリー) を確認
git log --oneline -1                      # 候補 sha を記録
```

## 2. Archive → Export → Upload

サンドボックス外 (通常ターミナル) で実行する。
`~/Library/Developer` へ書ける環境が必要。

```sh
SHA=$(git rev-parse HEAD)
xcodebuild -workspace ios/App/App.xcworkspace \
  -scheme App -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/Relay.xcarchive \
  -allowProvisioningUpdates \
  BUILD_SOURCE_COMMIT=$SHA archive

xcodebuild -exportArchive \
  -archivePath build/Relay.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist ios/ExportOptions.plist
```

初回は Xcode を一度開き、Runner…ではなく `App` ターゲットの
Signing で Team QVUR5T7J46 + Automatically manage signing を確認する。
`dev.relay.agentchat` の App Store プロファイルが自動作成される。

Upload (App Store Connect API キーが必要。`~/.private` 等に保管):

```sh
xcrun altool --upload-package build/export/*.ipa \
  -t ios --apiKey $API_KEY_ID --apiIssuer $ISSUER_ID --verbose
```

または Transporter.app に ipa をドラッグ＆ドロップ。

## 3. スクリーンショット

審査には実機/シミュレータの実写が必要。デモモードで撮影できる
(サーバー不要・私物情報を出さない)。

```sh
# 例: iPhone 17 Pro Max シミュレータで起動→デモ→撮影
xcrun simctl boot "iPhone 17 Pro Max"
xcodebuild -workspace ios/App/App.xcworkspace -scheme App \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' install
xcrun simctl io booted screenshot shot-connect.png
```

必要枠: iPhone 6.9 インチ (1320×2868)、iPad 13 インチ (2064×2752)。
小さい枠は Connect の自動縮小を利用。撮影対象: 接続→デモ→
チャット→承認→diff の 3〜5 枚。

## 4. App Store Connect 入力値 (下書き)

- 名前: `Relay`
- サブタイトル: `自宅サーバーの AI をチャットで使う`
- カテゴリ: 開発者ツール
- キーワード: `AI,チャット,開発,コード,エージェント,自宅サーバー,副業`
- 説明 (JP):
  `Relay は、自宅サーバー上で動く公式 AI コーディング CLI を、`
  `スマホのチャット画面から使うためのクライアントです。`
  `プロジェクト登録・スレッド・承認・差分確認まで、ターミナルなしで完結。`
  `サーバー不要のデモモード付き。認証情報は端末と利用者のサーバーにのみ保持します。`
- 説明 (EN):
  `Relay is a chat client for official AI coding CLIs running on your own home server.`
  `Projects, threads, approvals, and diffs — no terminal needed.`
  `Includes an offline demo mode. Credentials stay on your device and server.`
- サポート URL: (リポジトリ URL を公開時に記入)
- プライバシーポリシー URL: `ops/legal/privacy-policy.md` の公開 URL (手順 0 でホスト)

## 5. 審査メモ (テンプレート・提出時に実値へ置換)

```text
Relay は利用者自身のサーバーに接続するクライアントです。
審査はサーバー不要の「デモモード」で全導線を確認できます。

手順:
1. 起動 →「デモを見る」をタップ
2. デモプロジェクトのスレッドが開きます。指示を送信すると応答が流れます
3. 「本番にデプロイして」と送ると承認カードが出ます。許可/拒否を試せます
4. 右上の差分ボタンで変更内容を確認できます

実サーバー接続: 自宅サーバー + Tailscale 閉域のため、審査環境からの
接続は想定していません。デモモードが審査対象の全機能を再現します。

Build: 1.0.0 (XXX) / 録画: YYYY-MM-DD 実機 iPhone (iOS XX)
添付動画: relay-review-buildXXX.mp4 (sha256: …、… bytes)
```

## 6. 人手ゲート (チェックリスト)

- [ ] 法務文書ホスト (privacy/terms の URL 確定・連絡先記入)
- [ ] App Store Connect アプリ作成 + メタ入力 + スクショ
- [ ] TestFlight 処理待ち→ビルド選択
- [ ] 実機テスト (skill §4: 起動・中断・復帰・ロック・デモ全導線)
- [ ] 審査動画の撮影・QA (PII なし・Build 表示確認)
- [ ] skill `verify --stage source/binary/complete` の全ゲート
- [ ] 提出 (withdraw なしの初回。提出クリック前に二重確認)

## 7. 既知リスク

- **4.2 Minimum Functionality**: WebView 系は審査が厳しい。
  緩和策: ネイティブ振る舞い (haptics/keyboard/status-bar)、
  オフラインのデモモード、ローカル下書き。却下時は却下理由に
  個別対応 (ネイティブ機能の追加等)。
- **私設サーバー必須**: デモモードで審査可能にする設計。
  審査メモに明記する。
