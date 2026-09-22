import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pairingPayload, pairingText } from '../mac/lib.js';

// public/pairing.js はブラウザ用クラシックスクリプトなので vm で読み込む
const ctx = { URL };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(new URL('../public/pairing.js', import.meta.url), 'utf8'), ctx);
const { parsePairing } = ctx.RelayPairing;
const plain = (o) => ({ ...o });

describe('QR ペアリングの解釈', () => {
  it('Mac アプリのペアリング QR をそのまま読める', () => {
    const text = pairingText(pairingPayload({ lanUrl: 'http://192.168.1.10:8787', token: 'abc123' }));
    assert.deepEqual(plain(parsePairing(text)), { url: 'http://192.168.1.10:8787', token: 'abc123' });
  });

  it('URL?token= 形式も読める (パス・末尾スラッシュは落とす)', () => {
    assert.deepEqual(plain(parsePairing(' https://home.tail.ts.net/?token=t0k ')), {
      url: 'https://home.tail.ts.net',
      token: 't0k',
    });
  });

  it('Relay 以外の QR・形式違い・トークン欠落は理由付きで拒否', () => {
    assert.throws(() => parsePairing('{"app":"other","v":1,"url":"http://a","token":"x"}'), /Relay のペアリング QR ではありません/);
    assert.throws(() => parsePairing('{"app":"relay","v":2,"url":"http://a","token":"x"}'), /未対応/);
    assert.throws(() => parsePairing('{"app":"relay","v":1,"url":"http://a"}'), /トークン/);
    assert.throws(() => parsePairing('https://example.com/'), /トークン/);
    assert.throws(() => parsePairing('{"app":"relay","v":1,"url":"javascript:alert(1)","token":"x"}'), /http\(s\)/);
    assert.throws(() => parsePairing('こんにちは'), /URL/);
    assert.throws(() => parsePairing(''), /空/);
  });
});
