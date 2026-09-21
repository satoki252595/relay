# mac セットアップ (5分)

Relay サーバーを Mac に常駐させ、iPhone から使う手順です。
料金は [料金体系](../plan.md) を参照 (ローカル実行は無料)。

## 1. 導入

ターミナルで実行:

```sh
curl -fsSL https://raw.githubusercontent.com/satoki252595/relay/main/ops/install.sh | bash
```

Node.js 20+ がなければ Homebrew 経由で自動導入されます
(Homebrew 自体がない場合は先に https://brew.sh/ を参照)。

## 2. 接続情報を控える

完了時に表示されます:

```text
URL:    http://192.168.x.x:8787
token:  (64桁)
```

`qrencode` があれば QR も表示されます
(`brew install qrencode` で追加可能)。

## 3. iPhone アプリで接続

1. アプリを開く
2. サーバー URL と token を入力 → 接続する

同じ Wi-Fi 内で届きます。

## 4. よく使うコマンド

```sh
tail -f ~/relay-server/server.log        # ログ
launchctl list | grep relay              # 常駐確認
./ops/install.sh --uninstall             # 常駐解除 (要: リポジトリ内で実行)
```

## 5. 外出先から使う

[ops/tailscale-and-migration.md](../../ops/tailscale-and-migration.md) を参照。
Tailscale 上の URL (`https://xxx.ts.net`) をアプリに入れるだけです。

## 6. GitHub 連携を使う場合

```sh
brew install gh
gh auth login
```

詳細は [GitHub 接続](../connections/github.md)。
