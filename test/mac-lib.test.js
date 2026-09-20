import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickLanIPv4, pairingPayload, pairingText, mergePaths, readTokenFile } from '../mac/lib.js';

describe('pickLanIPv4', () => {
  it('外部 IPv4 の先頭を選ぶ (lo/内部・v6・リンクローカル除外)', () => {
    const ifs = {
      lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      en0: [
        { family: 'IPv6', address: 'fe80::1', internal: false },
        { family: 'IPv4', address: '192.168.1.10', internal: false },
      ],
      en1: [{ family: 'IPv4', address: '169.254.5.6', internal: false }],
    };
    assert.equal(pickLanIPv4(ifs), '192.168.1.10');
  });
  it('候補がなければ null', () => {
    assert.equal(pickLanIPv4({}), null);
    assert.equal(pickLanIPv4(null), null);
  });
});

describe('pairing', () => {
  it('payload は url+token を含む JSON になる', () => {
    const p = pairingPayload({ lanUrl: 'http://192.168.1.10:8787', token: 'sekret' });
    assert.equal(p.v, 1);
    assert.equal(p.app, 'relay');
    const back = JSON.parse(pairingText(p));
    assert.equal(back.url, 'http://192.168.1.10:8787');
    assert.equal(back.token, 'sekret');
  });
  it('欠落は例外', () => {
    assert.throws(() => pairingPayload({ lanUrl: '', token: 'x' }));
    assert.throws(() => pairingPayload({ lanUrl: 'http://x', token: '' }));
  });
});

describe('mergePaths', () => {
  it('shell 側を優先し重複を除く', () => {
    assert.equal(
      mergePaths('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin:/Users/u/.local/bin'),
      '/opt/homebrew/bin:/usr/bin:/Users/u/.local/bin:/bin',
    );
  });
  it('空入力に耐える', () => {
    assert.equal(mergePaths('', ''), '');
    assert.equal(mergePaths('/usr/bin', null), '/usr/bin');
  });
});

describe('readTokenFile', () => {
  it('末尾改行を除去して返す・不在は null', () => {
    const fs = {
      existsSync: (p) => p === '/d/.token',
      readFileSync: () => 'abc123\n',
    };
    assert.equal(readTokenFile(fs, '/d'), 'abc123');
    assert.equal(readTokenFile({ existsSync: () => false }, '/d'), null);
  });
});
