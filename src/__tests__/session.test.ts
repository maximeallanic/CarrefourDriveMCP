import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionService, parseCookieInput } from '../services/session.service.js';

const dir = mkdtempSync(join(tmpdir(), 'carrefour-mcp-test-'));

beforeEach(() => {
  process.env.CARREFOUR_SESSION_FILE = join(dir, 'cookies.json');
  delete process.env.CARREFOUR_COOKIES;
  delete process.env.CARREFOUR_COOKIE_FILE;
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('parseCookieInput accepts a raw cookie header', () => {
  assert.deepEqual(parseCookieInput(' a=1; b=x=y '), [
    { name: 'a', value: '1' },
    { name: 'b', value: 'x=y' },
  ]);
});

test('parseCookieInput accepts a JSON map', () => {
  assert.deepEqual(parseCookieInput('{"a":"1","b":"2"}'), [
    { name: 'a', value: '1' },
    { name: 'b', value: '2' },
  ]);
});

test('parseCookieInput accepts a browser JSON array export', () => {
  const parsed = parseCookieInput('[{"name":"a","value":"1","domain":".carrefour.fr","path":"/"}]');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'a');
  assert.equal(parsed[0].domain, '.carrefour.fr');
});

test('cookies are stored, exposed as a Cookie header, and persisted', () => {
  const s = new SessionService();
  assert.equal(s.hasSession(), false);

  const stored = s.importCookies('sid=abc; pref=fr');
  assert.equal(stored, 2);
  assert.equal(s.hasSession(), true);

  const header = s.getCookieHeader('https://www.carrefour.fr/api/cart');
  assert.match(header, /sid=abc/);
  assert.match(header, /pref=fr/);
  assert.ok(existsSync(process.env.CARREFOUR_SESSION_FILE!));

  // A brand new instance must pick the jar back up from disk.
  const reloaded = new SessionService();
  assert.match(reloaded.getCookieHeader(), /sid=abc/);
});

test('CARREFOUR_COOKIES seeds the jar from the environment', () => {
  process.env.CARREFOUR_SESSION_FILE = join(dir, 'env-cookies.json');
  process.env.CARREFOUR_COOKIES = 'envsid=zzz';
  const s = new SessionService();
  assert.match(s.getCookieHeader(), /envsid=zzz/);
});

test('clear() wipes both memory and the session file', () => {
  process.env.CARREFOUR_SESSION_FILE = join(dir, 'clear.json');
  const s = new SessionService();
  s.importCookies('sid=abc');
  assert.equal(s.hasSession(), true);
  s.clear();
  assert.equal(s.hasSession(), false);
  assert.equal(existsSync(join(dir, 'clear.json')), false);
});

test('Set-Cookie responses are folded back into the jar', () => {
  process.env.CARREFOUR_SESSION_FILE = join(dir, 'setcookie.json');
  const s = new SessionService();
  s.storeSetCookies(['newsid=fromserver; Path=/; Domain=.carrefour.fr'], 'https://www.carrefour.fr/api/cart');
  assert.match(s.getCookieHeader(), /newsid=fromserver/);
});
