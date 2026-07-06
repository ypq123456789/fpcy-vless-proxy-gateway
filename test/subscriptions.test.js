import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractProxyUrls, parseSubscriptionUrls } from '../src/subscriptions.js';

describe('parseSubscriptionUrls', () => {
  it('parses newline and whitespace separated subscription URLs', () => {
    const urls = parseSubscriptionUrls('https://a.example/sub\n https://b.example/sub  https://c.example/sub ');

    assert.deepEqual(urls, ['https://a.example/sub', 'https://b.example/sub', 'https://c.example/sub']);
  });
});

describe('extractProxyUrls', () => {
  it('extracts raw proxy URLs from plain text subscriptions', () => {
    const urls = extractProxyUrls('vless://one#one\nvmess://two\nss://ignored\nvless://three#three');

    assert.deepEqual(urls, ['vless://one#one', 'vmess://two', 'vless://three#three']);
  });

  it('extracts proxy URLs from base64 subscriptions', () => {
    const body = Buffer.from('vless://one#one\nvmess://two').toString('base64');

    assert.deepEqual(extractProxyUrls(body), ['vless://one#one', 'vmess://two']);
  });

  it('extracts proxy URLs from clash-style yaml subscriptions', () => {
    const body = `
proxies:
  - name: hk
    server: example.com
proxy-groups:
  - url: vless://one#one
  - url: "vmess://two"
`;

    assert.deepEqual(extractProxyUrls(body), ['vless://one#one', 'vmess://two']);
  });
});
