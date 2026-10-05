import {timingSafeEqual} from 'node:crypto';

export function cronAuthorized(request, secret = process.env.CRON_SECRET) {
  if (typeof secret !== 'string' || !secret.trim()) return false;
  const actual = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
