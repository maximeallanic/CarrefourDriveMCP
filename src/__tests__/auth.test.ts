import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionService } from '../services/session.service.js';
import { refreshSession, authorizeUrl } from '../services/auth.service.js';

const dir = mkdtempSync(join(tmpdir(), 'carrefour-auth-test-'));

beforeEach(() => {
  process.env.CARREFOUR_SESSION_FILE = join(dir, 'cookies.json');
  delete process.env.CARREFOUR_COOKIES;
  delete process.env.CARREFOUR_COOKIE_FILE;
});

after(() => rmSync(dir, { recursive: true, force: true }));

test('refreshSession refuses to run without an SSO cookie', async () => {
  process.env.CARREFOUR_SESSION_FILE = join(dir, 'nosso.json');
  const session = new SessionService();
  session.importCookies('sid=storefront-only');

  // No SSO cookie means no browser is started at all, so this stays offline.
  const result = await refreshSession(session);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-sso');
  assert.match(result.message, /c4iamsecuretk/);
});

test('the SSO cookie is read back from the IAM host, not the storefront', () => {
  process.env.CARREFOUR_SESSION_FILE = join(dir, 'sso.json');
  const session = new SessionService();

  session.importCookies('[{"name":"c4iamsecuretk","value":"tok","domain":"www.carrefour.fr","path":"/"}]');
  assert.equal(session.hasSso(), false, 'a same-named cookie on the storefront must not count');

  session.importCookies('[{"name":"c4iamsecuretk","value":"tok","domain":"moncompte.carrefour.fr","path":"/"}]');
  assert.equal(session.hasSso(), true);
  assert.equal(session.getSsoToken(), 'tok');
});

test('the authorize URL carries the OAuth parameters the storefront expects', () => {
  const url = new URL(authorizeUrl());
  assert.equal(url.origin, 'https://moncompte.carrefour.fr');
  assert.equal(url.pathname, '/iam/oauth2/CarrefourConnect/authorize');
  assert.equal(url.searchParams.get('client_id'), 'carrefour_onecarrefour_web');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://www.carrefour.fr/login/check');
});

test('the jar exports cookies in the shape Playwright expects, across both hosts', () => {
  process.env.CARREFOUR_SESSION_FILE = join(dir, 'export.json');
  const session = new SessionService();
  session.importCookies(
    '[{"name":"sid","value":"a","domain":"www.carrefour.fr","path":"/"},' +
      '{"name":"c4iamsecuretk","value":"b","domain":"moncompte.carrefour.fr","path":"/"}]'
  );

  const exported = session.toPlaywrightCookies();
  const byName = Object.fromEntries(exported.map((c) => [c.name, c]));
  assert.equal(byName.sid.domain, 'www.carrefour.fr');
  assert.equal(byName.c4iamsecuretk.domain, 'moncompte.carrefour.fr');
  for (const cookie of exported) {
    assert.equal(typeof cookie.path, 'string');
    assert.equal(typeof cookie.secure, 'boolean');
    assert.equal(typeof cookie.expires, 'number');
  }
});
