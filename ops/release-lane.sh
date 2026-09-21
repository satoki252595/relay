#!/bin/bash
# Relay iOS リリースレーン: source preflight → archive → export → binary preflight [→ upload]
# 通常ターミナル (サンドボックス外) のリポジトリ直下で実行する。
#   APP_ID=1234567890 ./ops/release-lane.sh
# upload まで行う場合 (App Store Connect API キー):
#   APP_ID=... API_KEY_ID=... API_ISSUER_ID=... KEY_P8=~/.private/AuthKey_X.p8 ./ops/release-lane.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
VALIDATOR="$HOME/.codex/skills/release-ios-app-store/scripts/ios_release_preflight.py"
EVIDENCE="${EVIDENCE_DIR:-$HOME/relay-evidence}"
: "${APP_ID:?APP_ID (App Store Connect の数値 App ID) を指定してください}"

HEAD="$(git rev-parse HEAD)"
mkdir -p "$EVIDENCE" build
echo "==> candidate $HEAD (APP_ID=$APP_ID)"

# 1. source config 生成 + source preflight (nix 環境の python/ffmpeg で実行)
python3 - "$REPO/ops/preflight-config-template.json" "$EVIDENCE/source-config.json" <<EOF
import json, sys
src, dst = sys.argv[1], sys.argv[2]
cfg = json.load(open(src))
cfg["repo"] = "$REPO"
cfg["release"]["app_store_connect_id"] = "$APP_ID"
cfg["provenance"]["source_commit"] = "$HEAD"
json.dump(cfg, open(dst, "w"), indent=2, ensure_ascii=False)
print("wrote", dst)
EOF

nix develop --command python3 "$VALIDATOR" verify --stage source \
  --config "$EVIDENCE/source-config.json" --strict-warnings
echo "==> SOURCE STAGE PASSED"

# API キー認証 (ある場合のみ。Xcode アカウント未設定でも archive/export が通る)
AUTH_ARGS=()
if [ -n "${API_KEY_ID:-}" ] && [ -n "${API_ISSUER_ID:-}" ] && [ -n "${KEY_P8:-}" ]; then
  AUTH_ARGS=(-authenticationKeyPath "$KEY_P8" -authenticationKeyID "$API_KEY_ID" -authenticationKeyIssuerID "$API_ISSUER_ID")
fi

# 1.5 Capacitor 同梱の PrivacyInfo 空配列を除去 (npm 再取得でも冪等に再適用)
python3 - <<EOF
import plistlib
for p in [
  "$REPO/node_modules/@capacitor/ios/Capacitor/Capacitor/PrivacyInfo.xcprivacy",
  "$REPO/node_modules/@capacitor/ios/CapacitorCordova/CapacitorCordova/PrivacyInfo.xcprivacy",
]:
  with open(p, "rb") as f:
    d = plistlib.load(f)
  if d.get("NSPrivacyAccessedAPITypes") == []:
    del d["NSPrivacyAccessedAPITypes"]
    with open(p, "wb") as f:
      plistlib.dump(d, f)
    print("patched", p)
  else:
    print("ok", p)
EOF

# 2. archive (プロファイルは -allowProvisioningUpdates で自動作成/更新)
# STRIP_* は全ターゲット (Pods 含む) に適用され、バイナリ内のビルドマシンパスを除去する
xcodebuild -workspace ios/App/App.xcworkspace \
  -scheme App -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$REPO/build/Relay.xcarchive" \
  -allowProvisioningUpdates \
  "${AUTH_ARGS[@]}" \
  BUILD_SOURCE_COMMIT="$HEAD" \
  DEPLOYMENT_POSTPROCESSING=YES STRIP_INSTALLED_PRODUCT=YES archive
echo "==> ARCHIVE DONE"

# 3. export (App Store Connect 提出用 ipa + DistributionSummary。upload は step 5)
rm -rf "$REPO/build/export"
xcodebuild -exportArchive \
  -archivePath "$REPO/build/Relay.xcarchive" \
  -exportPath "$REPO/build/export" \
  -exportOptionsPlist "$REPO/ios/ExportOptions.plist" \
  -allowProvisioningUpdates \
  "${AUTH_ARGS[@]}"
IPA="$(ls "$REPO/build/export/"*.ipa | head -n 1)"
echo "==> EXPORT DONE: $IPA"

# 4. binary config 凍結 + binary preflight (JSON 契約)
BINCFG="$EVIDENCE/binary-config.json"
BINREP="$EVIDENCE/binary-report.json"
if [ -e "$BINREP" ]; then echo "refusing to overwrite $BINREP" >&2; exit 1; fi
python3 - "$EVIDENCE/source-config.json" "$BINCFG" <<EOF
import json, sys
src, dst = sys.argv[1], sys.argv[2]
cfg = json.load(open(src))
cfg["allowed_missing_dsyms"] = {}
cfg["artifacts"] = {
  "archive": "$REPO/build/Relay.xcarchive",
  "ipa": "$IPA",
  "export_options": "$REPO/build/export/ExportOptions.plist",
  "distribution_summary": "$REPO/build/export/DistributionSummary.plist",
  "binary_config": "$BINCFG",
  "binary_report": "$BINREP",
}
json.dump(cfg, open(dst, "w"), indent=2, ensure_ascii=False)
print("wrote", dst)
EOF

nix develop --command python3 "$VALIDATOR" verify --stage binary \
  --format json --output "$BINREP" --config "$BINCFG" --strict-warnings
echo "==> BINARY STAGE PASSED"
python3 -c "import json; print('binary_preupload_fingerprint:', json.load(open('$BINREP'))['binary_preupload_fingerprint'])"

# 5. upload (API キーがある場合のみ。なければコマンドを表示して終了)
if [ -n "${API_KEY_ID:-}" ] && [ -n "${API_ISSUER_ID:-}" ] && [ -n "${KEY_P8:-}" ]; then
  # altool は ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8 を見る
  KEYDIR="$HOME/.appstoreconnect/private_keys"
  mkdir -p "$KEYDIR"
  [ -e "$KEYDIR/AuthKey_${API_KEY_ID}.p8" ] || cp "$KEY_P8" "$KEYDIR/AuthKey_${API_KEY_ID}.p8"
  xcrun altool --upload-package "$IPA" -t ios \
    --apiKey "$API_KEY_ID" --apiIssuer "$API_ISSUER_ID" --verbose
  echo "==> UPLOAD DONE. TestFlight の処理完了を待ってビルドを選択すること"
else
  echo "==> upload は未実施 (API キー未指定)。次を実行:"
  echo "    xcrun altool --upload-package \"$IPA\" -t ios --apiKey <KEY_ID> --apiIssuer <ISSUER> --verbose"
fi
