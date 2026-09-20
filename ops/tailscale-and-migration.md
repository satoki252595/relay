# 閉域公開 (Tailscale) と VM 移管メモ

## 前提
- Relay は `127.0.0.1:8787` で待つ。インターネット直公開はしない。
- スマホ・PC は同一 tailnet に参加させる。

## 公開 (ホスト機で一度だけ)
```sh
# Tailscale Serve で HTTPS 公開 (tailnet 内のみ)
tailscale serve --bg http://127.0.0.1:8787
# URL 確認
tailscale serve status
# 例: https://homeserver.tailXXXX.ts.net/
```
スマホはその URL + `data/.token` の内容で接続する。
ブラウザに「ホーム画面に追加」すると PWA 風に使える。

## 認証情報の所在
- 各 CLI の login セッションはホストの公式 CLI 領域のみ
  (`~/.claude.json`, `~/.codex/auth.json`, Cursor/Muse の既定領域)。
- Relay は API キーを保持しない。`RELAY_TOKEN` は UI↔ホスト間の合言葉。
- スマホに秘密鍵・API キーを置かない。

## 自宅サーバー → クラウド VM への移管手順
1. 新 VM に Node 20+, git, 各 CLI をインストールし、それぞれ `login`。
2. 本リポジトリを配置し `npm install --omit=dev`。
3. `data/` (スレッド・ジョブ履歴) と `projects/` (チェックアウト) を rsync。
   ```sh
   rsync -a --exclude node_modules homeserver:/opt/relay/data/ /opt/relay/data/
   rsync -a homeserver:/opt/relay/projects/ /opt/relay/projects/
   ```
4. `.env` (PORT/HOST/DATA_DIR/PROJECTS_ROOT) と `data/.token` を引き継ぐか再発行。
5. systemd unit を有効化し、Tailscale Serve を新ホストで再設定。
6. 旧ホストの `tailscale serve reset` と unit 停止。未完ジョブは新ホストで「中断」→「再開」扱いになる。

## 注意
- サブスク認証はホスト単位。VM 移管後は各 CLI に再 login が必要。
- `projects/` 配下の git リモート認証情報 (credential helper) もホスト側で再設定。
