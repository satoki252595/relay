# Linux セットアップ (5分)

Relay サーバーを Linux マシンに常駐させ、iPhone から使う手順です。
料金は [料金体系](../plan.md) を参照 (ローカル実行は無料)。
systemd 付きディストリ (Ubuntu/Debian/Fedora 等) を想定しています。

## 1. 導入

```sh
curl -fsSL https://raw.githubusercontent.com/satoki252595/relay/main/ops/install.sh | bash
```

Node.js 20+ がなければ `apt` 経由で自動導入されます
(apt がない環境は https://nodejs.org/ から手動導入)。

## 2. 接続情報を控える

完了時に表示されます:

```text
URL:    http://192.168.x.x:8787
token:  (64桁)
```

## 3. iPhone アプリで接続

1. アプリを開く
2. サーバー URL と token を入力 → 接続する

同じ LAN 内で届きます。ファイアウォール (ufw 等) を使う場合は
8787/tcp の受信を許可してください:

```sh
sudo ufw allow 8787/tcp
```

## 4. よく使うコマンド

```sh
systemctl --user status relay-server     # 常駐確認
journalctl --user -u relay-server -f     # ログ
./ops/install.sh --uninstall             # 常駐解除 (要: リポジトリ内で実行)
```

## 5. 外出先から使う

[ops/tailscale-and-migration.md](../../ops/tailscale-and-migration.md) を参照。
Tailscale 上の URL をアプリに入れるだけです。

## 6. GitHub 連携を使う場合

```sh
# Ubuntu/Debian の例 (他は https://cli.github.com/ を参照)
sudo apt-get install gh
gh auth login
```

詳細は [GitHub 接続](../connections/github.md)。
