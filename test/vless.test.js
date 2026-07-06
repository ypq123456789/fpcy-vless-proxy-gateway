import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHttpResponse, parseProxyPool, parseVlessUrl } from '../src/vless.js';

describe('parseVlessUrl', () => {
  it('parses VLESS WebSocket links without exposing the UUID in the label', () => {
    const parsed = parseVlessUrl('vless://2304956b-f58f-46a3-8f5f-819c3c00e3a8@example.com:11710?encryption=none&security=none&type=ws&path=%2F#node');

    assert.deepEqual(parsed, {
      uuid: '2304956b-f58f-46a3-8f5f-819c3c00e3a8',
      host: 'example.com',
      port: 11710,
      path: '/',
      network: 'ws',
      label: 'example.com:11710',
      wsUrl: 'ws://example.com:11710/'
    });
  });

  it('parses VLESS TCP links with security none', () => {
    const parsed = parseVlessUrl('vless://2304956b-f58f-46a3-8f5f-819c3c00e3a8@example.com:11710?encryption=none&security=none&type=tcp#node');

    assert.deepEqual(parsed, {
      uuid: '2304956b-f58f-46a3-8f5f-819c3c00e3a8',
      host: 'example.com',
      port: 11710,
      path: '/',
      network: 'tcp',
      label: 'example.com:11710'
    });
  });

  it('rejects VLESS Reality links because native Node cannot speak XTLS Reality', () => {
    assert.throws(
      () => parseVlessUrl('vless://2304956b-f58f-46a3-8f5f-819c3c00e3a8@example.com:11710?encryption=none&security=reality&type=tcp'),
      /security=none/
    );
  });
});

describe('parseProxyPool', () => {
  it('keeps supported VLESS nodes and reports unsupported nodes', () => {
    const pool = parseProxyPool(`
vless://2304956b-f58f-46a3-8f5f-819c3c00e3a8@example.com:11710?encryption=none&security=none&type=ws&path=%2F#ws
vless://e48efb5a-6a9d-4350-9ab7-c9f7976a2250@172.207.241.43:21266?encryption=none&security=none&type=tcp&headerType=none#tcp
vless://2aad25ce-a215-487b-b817-5c7b0787a885@159.138.7.126:64055?encryption=none&flow=xtls-rprx-vision&security=reality&type=tcp#reality
vmess://abc
    `);

    assert.equal(pool.supported.length, 2);
    assert.deepEqual(pool.supported.map(node => node.label), ['example.com:11710', '172.207.241.43:21266']);
    assert.equal(pool.unsupported.length, 2);
    assert.match(pool.unsupported[0].reason, /security=none/);
    assert.equal(pool.unsupported[1].label, 'vmess:unsupported');
    assert.match(pool.unsupported[1].reason, /only vless/);
  });
});

describe('parseHttpResponse', () => {
  it('decodes chunked upstream response bodies', () => {
    const response = Buffer.from('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/plain\r\n\r\n5\r\nhello\r\n0\r\n\r\n');

    const parsed = parseHttpResponse(response);

    assert.equal(parsed.status, 200);
    assert.equal(parsed.headers['content-type'], 'text/plain');
    assert.equal(parsed.body.toString(), 'hello');
  });
});
