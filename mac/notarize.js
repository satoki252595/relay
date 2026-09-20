/* electron-builder afterSign: Developer ID 署名済み .app を公証して staple。
 * 必要な環境変数 (iOS レーンの API キーと同じもの):
 *   APPLE_API_KEY_ID / APPLE_API_ISSUER_ID / APPLE_API_KEY_P8
 * 未設定なら署名のみで通過 (ローカル確認ビルド用)。
 */
import { execFileSync } from 'node:child_process';

export default async function notarize(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const keyId = process.env.APPLE_API_KEY_ID;
  const issuer = process.env.APPLE_API_ISSUER_ID;
  const keyP8 = process.env.APPLE_API_KEY_P8;
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  if (!keyId || !issuer || !keyP8) {
    console.warn('[notarize] API キー未設定のため公証をスキップ (署名のみ)');
    return;
  }
  execFileSync(
    'xcrun',
    ['notarytool', 'submit', appPath, '--key', keyP8, '--key-id', keyId, '--issuer', issuer, '--wait'],
    { stdio: 'inherit' },
  );
  execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' });
  console.log('[notarize] 公証 + staple 完了');
}
