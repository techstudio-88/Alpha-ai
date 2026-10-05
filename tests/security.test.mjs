import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable, Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {cronAuthorized} from '../lib/cron-auth.mjs';
import {isPublicAddress,byteLimit} from '../worker/download.js';
import {encryptCredential,decryptCredential} from '../lib/credential-cipher.mjs';

test('cron authorization fails closed when no secret is configured', () => {
  const req = value => new Request('https://example.com', {headers:{authorization:value}});
  for (const secret of [undefined,'',' ']) assert.equal(cronAuthorized(req('Bearer undefined'),secret),false);
  assert.equal(cronAuthorized(req('Bearer test-secret'),'test-secret'),true);
  assert.equal(cronAuthorized(req('Bearer wrong'),'test-secret'),false);
});
test('download resolver rejects private, mapped, link-local and reserved addresses', () => {
  for (const ip of ['127.0.0.1','10.1.2.3','192.168.1.1','172.16.0.1','169.254.169.254','100.64.0.1','198.18.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])
    assert.equal(isPublicAddress(ip),false,ip);
  assert.equal(isPublicAddress('8.8.8.8'),true);
  assert.equal(isPublicAddress('2606:4700::1111'),true);
});
test('streaming downloads stop at the cap even without Content-Length', async () => {
  const sink = () => new Writable({write(_chunk,_encoding,callback){callback()}});
  await pipeline(Readable.from([Buffer.alloc(4),Buffer.alloc(4)]),byteLimit(8),sink());
  await assert.rejects(pipeline(Readable.from([Buffer.alloc(4),Buffer.alloc(5)]),byteLimit(8),sink()),/size limit/);
});
test('queued source credentials are authenticated ciphertext, not plaintext',()=>{
  const value='fixture-access-token',secret='fixture-worker-secret';
  const sealed=encryptCredential(value,secret);
  assert.equal(sealed.includes(value),false);
  assert.equal(decryptCredential(sealed,secret),value);
  assert.throws(()=>decryptCredential(sealed,'different-worker-secret'));
  assert.throws(()=>decryptCredential(sealed.slice(0,-3)+'bad',secret));
  assert.throws(()=>encryptCredential(value,''));
});
