import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {isIP} from 'node:net';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {createWriteStream} from 'node:fs';
import {rm, statfs} from 'node:fs/promises';
import path from 'node:path';
import {sourceUrl} from '../lib/video-workflow.mjs';

export const MAX_DOWNLOAD_BYTES = Math.max(1, Number(process.env.MAX_DOWNLOAD_MB) || 512) * 1024 * 1024;

export function isPublicAddress(address) {
  if (isIP(address) === 6) return /^[23][\da-f]{3}:/i.test(address) && !/^2001:(?:db8|0|10|20):/i.test(address);
  if (isIP(address) !== 4) return false;
  const [a,b,c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export function byteLimit(max = MAX_DOWNLOAD_BYTES) {
  let total = 0;
  return new Transform({transform(chunk, _encoding, callback) {
    total += chunk.length;
    callback(total > max ? new Error('Video exceeds the configured download size limit.') : null, chunk);
  }});
}

// Pin the checked DNS answer to the TLS connection, including on every redirect.
// A second, unchecked resolution by fetch() would permit DNS rebinding.
async function responseFor(url, headers) {
  const addresses = await lookup(url.hostname, {all:true});
  if (!addresses.length || addresses.some(({address}) => !isPublicAddress(address)))
    throw new Error('The video URL resolves to a non-public network address.');
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(url, {headers, signal:AbortSignal.timeout(30 * 60 * 1000),
      lookup: (_host, options, callback) => options.all ? callback(null,[address]) : callback(null,address.address,address.family)}, resolve);
    req.on('error', reject);
    req.end();
  });
}

export async function publicDownload(value, out, {headers = {}, maxBytes = MAX_DOWNLOAD_BYTES} = {}) {
  let url = new URL(sourceUrl(value).url);
  const originalOrigin = url.origin;
  const disk = await statfs(path.dirname(out));
  if (disk.bavail * disk.bsize < maxBytes + 256 * 1024 * 1024)
    throw new Error('The worker does not have enough free disk space for this import.');
  try {
    for (let redirect = 0; redirect < 6; redirect++) {
      const response = await responseFor(url, url.origin === originalOrigin ? headers : {});
      if ([301,302,303,307,308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.destroy();
        if (!location) throw new Error('Video redirect has no destination.');
        url = new URL(sourceUrl(new URL(location,url).toString()).url);
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.destroy();
        throw new Error(`Video download failed (HTTP ${response.statusCode}). Check source access.`);
      }
      if (Number(response.headers['content-length']) > maxBytes) {
        response.destroy();
        throw new Error('Video exceeds the configured download size limit.');
      }
      await pipeline(response, byteLimit(maxBytes), createWriteStream(out));
      return;
    }
    throw new Error('Video source redirected too many times.');
  } catch (error) {
    await rm(out,{force:true});
    throw error;
  }
}
