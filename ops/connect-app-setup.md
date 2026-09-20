# App Store Connect 初回設定 (5分・1回だけ)

ブラウザで [App Store Connect](https://appstoreconnect.apple.com) にサインインし、
以下を1回の訪問で済ませる。

## A. アプリ作成 (必須・App ID 取得)

1. マイ App → 左上 `+` → 新規 App
2. プラットフォーム: iOS / 名前: `Relay` / 主言語: 日本語
3. バンドル ID: `dev.relay.agentchat` を選択
4. SKU: `relay-ios` / ユーザアクセス: フルアクセス
5. 作成 → URL 末尾の数字 (例 `.../apps/1234567890/...`) が **App ID**。
   これを控えて `./ops/release-lane.sh` の `APP_ID` に使う。

## B. API キー発行 (upload 用・推奨)

1. ユーザとアクセス → 統合 → App Store Connect API → チームキー `+`
2. 名前: `relay-upload`、アクセス: App Manager
3. `AuthKey_XXXX.p8` をダウンロード → `~/.private/` に保管 (再入手不可)
4. 発行者 ID (Issuer ID) とキー ID を控える。
   `release-lane.sh` の `API_ISSUER_ID` / `API_KEY_ID` / `KEY_P8` に使う。

API キーを作らない場合は Transporter.app で `build/export/*.ipa` を
ドラッグ＆ドロップしてアップロードする (手動)。
