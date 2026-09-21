# Windows セットアップ (10分)

Relay サーバーを Windows PC に常駐させ、iPhone から使う手順です。
料金は [料金体系](../plan.md) を参照 (ローカル実行は無料)。
Windows 10/11 + PowerShell を想定しています。

## 1. 導入

PowerShell で実行:

```powershell
irm https://raw.githubusercontent.com/satoki252595/relay/main/ops/install.ps1 | iex
```

Node.js LTS / Git がなければ winget 経由で自動導入されます。

## 2. 接続情報を控える

完了時に表示されます:

```text
URL:    http://192.168.x.x:8787
token:  (64桁)
```

ファイアウォールの確認が出たら「許可」してください。

## 3. iPhone アプリで接続

1. アプリを開く
2. サーバー URL と token を入力 → 接続する

同じ Wi-Fi 内で届きます。`http://` のまま使えます
(自宅 LAN 内の利用を想定)。

## 4. よく使う操作

- 常駐は「ログオン時に起動」のタスク (`RelayServer`) として登録されます
- 解除: `.\ops\install.ps1 -Uninstall` (リポジトリ内で実行)
- ログ: タスクスケジューラ → RelayServer → 履歴、または手動起動時の画面出力

## 5. 外出先から使う

[ops/tailscale-and-migration.md](../../ops/tailscale-and-migration.md) を参照。
Tailscale 上の URL をアプリに入れるだけです。

## 6. GitHub 連携を使う場合

```powershell
winget install GitHub.cli
gh auth login
```

詳細は [GitHub 接続](../connections/github.md)。
