/* Relay mac 版 preload。contextIsolation のまま、main が渡した設定を公開する。
 * main 窓 (http://127.0.0.1) 専用: window.relayDesktop { base, token, lanUrl, openPairing() }
 * ペアリング窓 (file://) は preload 不要 (URL ハッシュを自前パース)。
 */
const { contextBridge, ipcRenderer } = require('electron');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--relay-${name}=`));
  return hit ? hit.slice(`--relay-${name}=`.length) : '';
};
contextBridge.exposeInMainWorld('relayDesktop', {
  base: arg('base'),
  token: arg('token'),
  lanUrl: arg('lan'),
  openPairing: () => ipcRenderer.send('relay-open-pairing'),
});
