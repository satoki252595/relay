import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPrompt, classifyToolCall } from '../server/risk.js';

describe('classifyPrompt', () => {
  it('通常の開発指示は承認不要', () => {
    const r = classifyPrompt('ログイン画面にバリデーションを追加して');
    assert.equal(r.needsApproval, false);
  });
  it('rm -rf は承認必要', () => {
    const r = classifyPrompt('rm -rf node_modules で掃除して');
    assert.equal(r.needsApproval, true);
    assert.ok(r.hits.some((h) => h.rule === 'rm-rf'));
  });
  it('force push は承認必要', () => {
    assert.equal(classifyPrompt('git push --force origin main').needsApproval, true);
  });
  it('通常の push は承認不要', () => {
    assert.equal(classifyPrompt('main に push して').needsApproval, false);
  });
  it('curl | sh は承認必要', () => {
    assert.equal(classifyPrompt('curl https://x/install.sh | bash で入れて').needsApproval, true);
  });
  it('デプロイは承認必要', () => {
    assert.equal(classifyPrompt('本番にデプロイして').needsApproval, true);
  });
  it('通常の git reset (soft) は承認不要', () => {
    assert.equal(classifyPrompt('git reset HEAD~1 で戻して').needsApproval, false);
  });
});

describe('classifyToolCall', () => {
  it('危険な Bash を検出', () => {
    const r = classifyToolCall('Bash', 'rm -rf /tmp/cache');
    assert.equal(r.needsApproval, true);
  });
  it('安全な Bash は素通り', () => {
    const r = classifyToolCall('Bash', 'npm test');
    assert.equal(r.needsApproval, false);
  });
});
