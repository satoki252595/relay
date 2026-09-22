# 完了通知 (APNs プッシュ)

ジョブの完了・エラー・承認待ちを iPhone にプッシュ通知します。
アプリを開いている間は通知センターに出さず、画面内表示のみです。

## 仕組み

- アプリが APNs デバイストークンを取得し、サーバーに登録
  (`POST /api/push-tokens`。トークンは自サーバーの `data/` 配下のみに保存)
- ジョブ完了時にサーバーが APNs へ直接送信 (Apple 以外の第三者は介さない)
- 通知タップで該当スレッドを開く

## サーバー設定 (1回だけ)

1. [Apple Developer – Keys](https://developer.apple.com/account/resources/authkeys/list)
   で Key を作成し、Apple Push Notifications service (APNs) にチェック。
   `.p8` をダウンロードし、Key ID を控える
2. サーバーの `.env` に追記:

```sh
APNS_KEY_P8=/path/to/AuthKey_XXXXXX.p8
APNS_KEY_ID=XXXXXX
APNS_TEAM_ID=QVUR5T7J46
# APNS_PRODUCTION=0   # 開発ビルドで検証するときだけ (TestFlight/製品版は 1 のまま)
```

3. サーバー再起動。`GET /api/push/status` で `configured: true` を確認

`.p8` は秘密鍵です。リポジトリに入れず、サーバーホスト上のみに置きます。

## iPhone 側

- 接続時に通知許可を求めます (一度だけ)。許可すると自動登録
- プロジェクト画面右上の「通知ON/OFF」で切替。OFF にすると登録解除

## 注意

- 開発ビルドは APNs sandbox、本番/TestFlight は production。
  環境が違うと届かないため、開発検証時は `APNS_PRODUCTION=0`
- 無効トークン (アプリ削除等) は送信時の 410 応答で自動削除
