/* Relay mac 版シェル (Electron main)。
 * - 既存 server/ を in-process で起動 (server コード無改変)
 * - public/ UI を BrowserWindow に表示
 * - ペアリング窓 (QR: LAN URL + token) を提供
 * 使い方: npx electron mac/main.js [--smoke-test]
 */
import { app, BrowserWindow, Menu, dialog, shell, ipcMain } from 'electron';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickLanIPv4, pairingPayload, pairingText, mergePaths, readTokenFile } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SMOKE = process.argv.includes('--smoke-test');

function fixPath() {
  try {
    const shellPath = execFileSync(process.env.SHELL || '/bin/zsh', ['-lic', 'echo $PATH'], {
      encoding: 'utf8',
      timeout: 8000,
    }).trim().split('\n').pop();
    process.env.PATH = mergePaths(process.env.PATH, shellPath);
  } catch {
    process.env.PATH = mergePaths(process.env.PATH, '/opt/homebrew/bin:/usr/local/bin');
  }
}

async function bootServer() {
  const userData = app.getPath('userData');
  process.env.DATA_DIR = process.env.DATA_DIR || path.join(userData, 'relay-data');
  process.env.PROJECTS_ROOT = process.env.PROJECTS_ROOT || path.join(userData, 'relay-projects');
  process.env.HOST = process.env.HOST || '0.0.0.0'; // LAN ペアリング用に公開 (認証は token)
  process.env.PORT = process.env.PORT || '8787';
  await import(path.join(REPO_ROOT, 'server', 'index.js'));
  const token = readTokenFile(fs, process.env.DATA_DIR);
  if (!token) throw new Error('server token を読めませんでした');
  return { port: Number(process.env.PORT), token };
}

function lanUrl(port) {
  const ip = pickLanIPv4(os.networkInterfaces());
  return ip ? `http://${ip}:${port}` : null;
}

function createMainWindow(base, desktop) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Relay',
    backgroundColor: '#101218',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        `--relay-base=${base}`,
        `--relay-token=${desktop.token}`,
        `--relay-lan=${desktop.lanUrl}`,
      ],
    },
    show: !SMOKE,
  });
  win.loadURL(base);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  return win;
}

function pairingFileUrl(payload) {
  const hash = Buffer.from(pairingText(payload), 'utf8').toString('base64url');
  return `file://${path.join(__dirname, 'pairing.html')}#${hash}`;
}

function openPairing(payload, { show = true } = {}) {
  const win = new BrowserWindow({
    width: 420,
    height: 620,
    resizable: false,
    title: 'iPhone と接続',
    backgroundColor: '#101218',
    show,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(pairingFileUrl(payload));
  win.setMenu(null);
  return win;
}

function buildMenu(mainWin, payload) {
  const template = [
    {
      label: 'Relay',
      submenu: [
        { label: 'Relay について', role: 'about' },
        { type: 'separator' },
        { label: 'iPhone と接続…', accelerator: 'CmdOrCtrl+K', click: () => openPairing(payload) },
        { type: 'separator' },
        { label: 'Relay を終了', role: 'quit' },
      ],
    },
    {
      label: '表示',
      submenu: [
        { label: '再読み込み', accelerator: 'CmdOrCtrl+R', click: () => mainWin.webContents.reload() },
        { label: '開発者ツール', accelerator: 'Alt+CmdOrCtrl+I', click: () => mainWin.webContents.toggleDevTools() },
      ],
    },
    { label: 'ウィンドウ', submenu: [{ label: '最小化', role: 'minimize' }, { label: '閉じる', role: 'close' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function smokeHealth(base) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return true;
    } catch { /* 起動待ち */ }
    await delay(300);
  }
  return false;
}

async function smoke(win, pairingWin, base) {
  if (!(await smokeHealth(base))) {
    console.error('SMOKE-FAIL: server に到達できませんでした');
    app.exit(1);
    return;
  }
  const checks = {};
  for (let i = 0; i < 100; i++) {
    try {
      checks.desktop = await win.webContents.executeJavaScript(
        `!!(window.relayDesktop && window.relayDesktop.token && document.body.classList.contains('desktop') && document.getElementById('dside') && document.getElementById('dtabbar'))`,
      );
      checks.qr = await pairingWin.webContents.executeJavaScript(
        `!!(document.getElementById('qr').children.length > 0 && document.getElementById('pair-url').textContent && document.getElementById('pair-token').textContent)`,
      );
      if (checks.desktop && checks.qr) break;
    } catch { /* 読込待ち */ }
    await delay(300);
  }
  console.log(`SMOKE desktop=${!!checks.desktop} pairing-qr=${!!checks.qr}`);
  app.exit(checks.desktop && checks.qr ? 0 : 1);
}

async function ready() {
  fixPath();
  let server;
  try {
    server = await bootServer();
  } catch (err) {
    if (!SMOKE) dialog.showErrorBox('Relay を起動できません', String(err.message || err));
    else console.error('SMOKE-FAIL', err);
    app.exit(1);
    return;
  }
  const base = `http://127.0.0.1:${server.port}`;
  const lan = lanUrl(server.port);
  const payload = pairingPayload({ lanUrl: lan || base, token: server.token });

  ipcMain.on('relay-open-pairing', () => openPairing(payload));

  if (SMOKE) {
    const win = createMainWindow(base, { token: server.token, lanUrl: lan || base });
    const pairingWin = openPairing(payload, { show: false });
    win.webContents.once('did-finish-load', () => smoke(win, pairingWin, base));
    win.webContents.once('did-fail-load', (_e, code, desc) => {
      console.error(`SMOKE-FAIL load ${code} ${desc}`);
      app.exit(1);
    });
    setTimeout(() => {
      console.error('SMOKE-FAIL timeout');
      app.exit(1);
    }, 60000).unref?.();
    return;
  }
  if (!lan) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Relay',
      message: 'LAN アドレスが見つかりません。iPhone ペアリングは利用できません (この Mac 上では動作します)。',
    });
  }
  const mainWin = createMainWindow(base, { token: server.token, lanUrl: lan || base });
  buildMenu(mainWin, payload);
}

app.setName('Relay');
app.whenReady().then(ready);
app.on('window-all-closed', () => app.quit());
