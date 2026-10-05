import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type Socket } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { HostBrowser } from '../services/host-browser.js';
import { SessionService, SSO_COOKIE_NAME } from '../services/session.service.js';
import { registerSessionTools } from '../tools/session.tools.js';
import { registerSpecTools } from '../spec/register.js';
import { loadToolSpecs } from '../spec/loader.js';

/**
 * The lent-browser mode against a fake host. The lines below are the contract: the host's own
 * test (personas-engine, test/unit/carrefour-drive.navigateur-prete.test.ts) replays the same
 * ones against its real socket. Hosts are invented.
 */
const dir = mkdtempSync(join(tmpdir(), 'carrefour-host-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const TOKEN = 'a'.repeat(64);
const CART = 'https://www.drive-sample.com/api/cart?trace=1';

type Seen = Record<string, unknown>;

/** A host that answers by the protocol: `reply(line)` gives the answer object, or null to close. */
async function fakeHost(reply: (line: Seen) => Seen | null): Promise<{ path: string; seen: Seen[]; server: Server }> {
  const path = join(dir, `h-${Math.random().toString(36).slice(2)}.sock`);
  const seen: Seen[] = [];
  const server = createServer((socket: Socket) => {
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = JSON.parse(buf.slice(0, i)) as Seen;
        buf = buf.slice(i + 1);
        seen.push(line);
        if (line.token !== TOKEN) return socket.destroy();
        const out = reply(line);
        if (!out) return socket.destroy();
        socket.write(`${JSON.stringify(out)}\n`);
      }
    });
  });
  await new Promise<void>((r) => server.listen(path, r));
  return { path, seen, server };
}

const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

test('contract: fetch, navigate and cookies are the lines the host expects, and its answers are read back', async () => {
  const host = await fakeHost((l) => {
    if (l.op === 'fetch') return { id: l.id, ok: true, result: { status: 401, statusText: 'Unauthorized', url: CART, contentType: 'application/json', cfMitigated: false, text: '{}' } };
    if (l.op === 'navigate') return { id: l.id, ok: true, result: { status: 200, url: 'https://iam.drive-sample.com/oauth/authorize' } };
    return { id: l.id, ok: true, result: { names: ['iam_sso_token', 'lang'] } };
  });
  const b = new HostBrowser(host.path, TOKEN);
  const req = { method: 'GET', url: CART, headers: { accept: 'application/json' } };
  assert.deepEqual(await b.fetch(req), { status: 401, statusText: 'Unauthorized', ok: false, url: CART, contentType: 'application/json', text: '{}' });
  assert.deepEqual(await b.navigate('https://iam.drive-sample.com/oauth/authorize'), { status: 200, finalUrl: 'https://iam.drive-sample.com/oauth/authorize' });
  assert.deepEqual(await b.cookieNames('https://iam.drive-sample.com'), ['iam_sso_token', 'lang']);
  assert.deepEqual(host.seen, [
    { id: 1, token: TOKEN, op: 'fetch', req },
    { id: 2, token: TOKEN, op: 'navigate', url: 'https://iam.drive-sample.com/oauth/authorize' },
    { id: 3, token: TOKEN, op: 'cookies', origin: 'https://iam.drive-sample.com' },
  ]);
  assert.deepEqual(b.describe(), { running: true, headed: false, profile: 'lent by host' });
  await b.close();
  await close(host.server);
});

test("a refusal of the host comes back in the host's own words", async () => {
  const host = await fakeHost((l) => ({ id: l.id, ok: false, error: "exchange_refused — elsewhere-sample.org is not among drive-sample's hosts" }));
  const b = new HostBrowser(host.path, TOKEN);
  await assert.rejects(b.fetch({ method: 'GET', url: 'https://elsewhere-sample.org/', headers: {} }), /not among drive-sample's hosts/);
  await b.close();
  await close(host.server);
});

test('a host that closes the bridge (a token it refuses) fails the request in flight', async () => {
  const host = await fakeHost(() => null);
  const b = new HostBrowser(host.path, 'b'.repeat(64));
  await assert.rejects(b.cookieNames('https://www.drive-sample.com'), /closed the browser bridge/);
  await close(host.server);
});

test('lent mode: hasSso() and hasSession() come from the names the host holds, and no jar is written', async () => {
  const file = join(dir, 'lent-cookies.json');
  process.env.CARREFOUR_SESSION_FILE = file;
  const host = await fakeHost((l) => ({
    id: l.id,
    ok: true,
    result: { names: String(l.origin).includes('moncompte') ? [SSO_COOKIE_NAME] : ['storefront_sid'] },
  }));
  const b = new HostBrowser(host.path, TOKEN);
  const s = new SessionService({ host: b });
  assert.equal(s.hasSso(), false, 'nothing is known before the host is asked');
  await s.ready();
  assert.equal(s.hasSso(), true);
  assert.equal(s.hasSession(), true);
  assert.equal(s.getSsoToken(), null, 'a value never crosses the bridge');
  assert.equal(s.importCookies('sid=abc'), 0);
  s.persist();
  s.clear();
  assert.equal(existsSync(file), false);
  assert.equal(s.status().sessionFile, 'held by the host');
  assert.deepEqual(host.seen.map((l) => l.origin), ['https://www.carrefour.fr', 'https://moncompte.carrefour.fr']);
  await b.close();
  await close(host.server);
  delete process.env.CARREFOUR_SESSION_FILE;
});

test('lent mode registers none of the six excluded tools, and the 42 others', () => {
  const names: string[] = [];
  const server = { tool: (name: string) => names.push(name) } as unknown as McpServer;
  registerSessionTools(server, { lent: true });
  registerSpecTools(server, loadToolSpecs(), { lent: true });
  for (const excluded of [
    'carrefour_set_cookies',
    'carrefour_clear_session',
    'carrefour_browser_login',
    'validate_checkout_slot',
    'validate_checkout_summary',
    'submit_checkout_payment',
  ]) {
    assert.equal(names.includes(excluded), false, excluded);
  }
  assert.equal(names.length, 42);
  assert.ok(names.includes('carrefour_session_status'));
  assert.ok(names.includes('carrefour_refresh_session'));
  assert.ok(names.includes('select_cart_delivery_slot'));
});

test('without the variable nothing changes: all 48 are registered (browser login when playwright is there)', () => {
  const names: string[] = [];
  const server = { tool: (name: string) => names.push(name) } as unknown as McpServer;
  registerSessionTools(server, { lent: false });
  registerSpecTools(server, loadToolSpecs(), { lent: false });
  assert.ok(names.length === 48 || (names.length === 47 && !names.includes('carrefour_browser_login')));
  assert.ok(names.includes('submit_checkout_payment'));
  assert.ok(names.includes('carrefour_set_cookies'));
});
