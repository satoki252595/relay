import { buildApp } from './api.js';
import { HOST, PORT, TOKEN_WAS_GENERATED, DATA_DIR } from './config.js';
import { reconcileOnBoot } from './jobs.js';

const orphans = reconcileOnBoot();
if (orphans > 0) {
  console.log(`[relay] ${orphans} 件の未完ジョブを「中断」扱いにしました (再開可)`);
}

const app = buildApp();
app.listen(PORT, HOST, () => {
  console.log(`[relay] listening on http://${HOST}:${PORT}`);
  console.log(`[relay] data: ${DATA_DIR}`);
  if (TOKEN_WAS_GENERATED) {
    console.log('[relay] 初回トークンを data/.token に生成しました (閉域でのみ共有)');
  }
  console.log('[relay] 公開は Tailscale Serve / funnel 等の閉域経由を推奨 (0.0.0.0 直公開は非推奨)');
});
