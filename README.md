# Relay — Agent Chat Client

裏は各社公式 CLI（サブスク login 済みセッション）。表は Claude Code 風の
チャット／プロジェクト画面。スマホからはブラウザ＋端末音声認識で指示できる。
ターミナルは UI に出さない。

## 対応ハーネス（送信先として選択）

| ID | CLI | 実行形態 |
|----|-----|---------|
| `claude` | `claude` (Anthropic) | `claude -p --output-format stream-json` |
| `codex` | `codex` (OpenAI) | `codex exec --json --sandbox workspace-write` |
| `muse` | `muse` (Meta) | `muse exec --json` |
| `cursor` | `cursor-agent` (Cursor) | `cursor-agent -p --output-format stream-json` |

API キー直打ちはしない。ホストで一度 `login` した公式 CLI の
セッション領域をそのまま使う。Relay は鍵を持たない。

## 構成

```
relay/
  server/            ホスト常駐デーモン (Node 20+, 依存は express のみ)
    index.js         起動
    api.js           REST + SSE
    jobs.js          実行エンジン (spawn/中断/再開/承認ゲート)
    harnesses/       4 CLI のアダプタ (引数組立・stream-json 解釈)
    risk.js          危険操作の分類器 (実行前 + 実行中の二重ゲート)
    git.js / store.js  プロジェクト・diff・永続化
  public/            ブラウザ UI (ビルド不要・CDN 不要のオフライン動作)
    index.html app.js style.css
  ops/               systemd unit, Tailscale/移管手順
  test/              node:test (21 件)
```

通信: UI→ホストは REST、ホスト→UI は SSE。
ブラウザを閉じてもジョブはホストで継続し、開き直すと追いつく。

## iOS アプリ (App Store 提出用)

`public/` を Capacitor で束ねたネイティブシェル (`ios/`)。
Bundle ID `dev.relay.agentchat`、Team QVUR5T7J46、初回 1.0.0 (1)。

- 審査・試用できる**デモモード**付き (接続画面→「デモを見る」)
- 自宅 LAN の `http://` 到達用に `NSAllowsLocalNetworking` を設定
- 手順・メタ・審査メモは [ios/RELEASE.md](ios/RELEASE.md)、
  法務文書は [ops/legal](ops/legal)

```sh
npm run cap:sync   # Web 資産を iOS へ同期
```

## macOS アプリ (Electron ホスト)

iPhone 版の相手役になるデスクトップホスト。同一 `server/` を内蔵起動し、
`public/` UI を拡張レイアウト (サイドバー＋並列セッションタブ) で表示する。
モバイル向け挙動は不変 (拡張は Electron 検出時のみ有効化)。

```sh
npm run desktop         # 開発起動 (データは ~/Library/Application Support/Relay)
npm run desktop:smoke   # 起動・自動接続・QR の headless 検証
npm run desktop:dist    # 署名+公証つき DMG/ZIP (要: Developer ID 証明書 + API キー)
```

- メニュー / サイドバーの「iPhone と接続」から QR (LAN URL＋トークン) を表示。
  iPhone は同じ Wi-Fi から手入力で接続 (外出先は Tailscale 経由)。
- データ・プロジェクトは `~/Library/Application Support/Relay/` 配下。
  公式 CLI はログインシェルの PATH で検出する。
- 未署名のローカル確認ビルド:
  `npx electron-builder --config mac/builder.json --mac -c.mac.identity=null`
- 公証には `APPLE_API_KEY_ID` / `APPLE_API_ISSUER_ID` / `APPLE_API_KEY_P8`
  (iOS レーンと同一キー) を設定。未設定なら署名のみで通過する。

## セットアップ（自宅サーバー）

かんたん導入は OS 別手順へ:
[mac](docs/setup/mac.md) / [Linux](docs/setup/linux.md) / [Windows](docs/setup/windows.md)。
料金は [料金体系](docs/plan.md) (ローカル実行は無料、VM 実行は提供準備中)。
GitHub 連携は [GitHub 接続](docs/connections/github.md)。
完了通知は [プッシュ通知設定](docs/setup/push-notifications.md)。

手動導入:

```sh
git clone https://github.com/satoki252595/relay.git /opt/relay && cd /opt/relay
npm install --omit=dev
cp .env.example .env   # 必要なら編集

# 各 CLI に login (サブスク認証はホスト側で完結)
claude login      # または各 CLI の手順
codex login
muse login
cursor-agent login

node server/index.js
# → http://127.0.0.1:8787
# → 初回トークンは data/.token に生成される
```

スマホ公開は [ops/tailscale-and-migration.md](ops/tailscale-and-migration.md) 参照
（Tailscale Serve で tailnet 内 HTTPS 公開）。

## 使い方（画面の流れ）

1. **接続**: サーバー URL + トークン。
2. **プロジェクト**: 空フォルダ作成 or `git clone` で登録。スレッドはプロジェクト単位。
3. **チャット**: スレッドを開き、送信先ハーネスを選んで送信。Markdown 表示。
   - 🎙ボタンで端末音声認識→テキスト入力（Chrome/Edge/Safari）。
   - **実行/相談**切替: 相談は変更せず計画・回答のみ（スレッド単位で保持）。
   - `@` でファイル言及（候補から挿入）。時計ボタンでプロンプト履歴。
   - 実行中は送信ボタンが**中断**に変化。考えが浮かんだら Enter で**待機送信**（完了後に自動送信）。
   - 中断・失敗後は**再開**（対応 CLI はセッション resume）。
4. **承認**: 危険操作（削除・force push・デプロイ等）は実行前に承認カード。
   実行中に危険な tool 実行を検出したら自動停止して承認待ちにする。
5. **diff**: ヘッダの `diff` で同画面に変更一覧＋パッチ表示。
   ジョブ開始時の**チェックポイント**に戻す巻き戻し付き（現状は退避してから戻す）。

## 承認ゲートの仕様

- 実行前: `server/risk.js` が指示文を分類。該当すれば CLI を起動せず `awaiting_approval`。
- 実行中: stream 出力の tool 実行を監視。危険パターンで SIGINT 停止→承認待ち。
  許可で再開（続きから）、拒否で終了。
- 既定は安全側: `--dangerously-skip-permissions` / `--force` / `danger-full-access`
  は付けない。codex は `workspace-write` sandbox。

## 受け入れ確認

- [ ] 各 CLI に login 済みなら、チャット送信→実行→結果表示ができる
- [ ] 作成→指示→diff→承認までターミナルなしで完結する
- [ ] 音声入力でも同じ操作ができる
- [ ] ブラウザを閉じても `data/job_*.log` が伸び続け、開き直すと追従する
- [ ] `npm test` が 21/21 緑

## やらないこと（初期スコープ外）

自前推論、サブスクの再販、スマホ IDE、公式 CLI の再実装。
