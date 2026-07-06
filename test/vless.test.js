import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHttpResponse, parseVlessUrl } from '../src/vless.js';

describe('parseVlessUrl', () => {
  it('parses VLESS WebSocket links without exposing the UUID in the label', () => {
    const parsed = parseVlessUrl('vless://2304956b-f58f-46a3-8f5f-819c3c00e3a8@example.com:11710?encryption=none&security=none&type=ws&path=%2F#node');

    assert.deepEqual(parsed, {
      uuid: '2304956b-f58f-46a3-8f5f-819c3c00e3a8',
      host: 'example.com',
      port: 11710,
      path: '/',
      label: 'example.com:11710',
      wsUrl: 'ws://example.com:11710/'
    });
  });

  it('rejects non-WebSocket VLESS links', () => {
    assert.throws(
      () => parseVlessUrl('vless://2304956b-f58f-46a3-8f5f-819c3c00e3a8@example.com:11710?encryption=none&type=tcp'),
      /WebSocket/
    );
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
