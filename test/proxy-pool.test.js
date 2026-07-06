import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createProxyPool } from '../src/proxy-pool.js';

describe('createProxyPool', () => {
  it('uses active proxies first and falls back to supported proxies while health is empty', () => {
    const pool = createProxyPool({
      supported: [{ label: 'a' }, { label: 'b' }],
      unsupported: []
    });

    assert.equal(pool.pickProxy().label, 'a');
    assert.equal(pool.pickProxy().label, 'b');

    pool.replaceActive([{ label: 'b' }], [{ label: 'a', reason: 'timeout' }]);

    assert.equal(pool.pickProxy().label, 'b');
    assert.equal(pool.snapshot().pool_count, 1);
    assert.equal(pool.snapshot().inactive_count, 1);
  });
});
