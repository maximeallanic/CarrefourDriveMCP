/**
 * The protocol between this server and a host that lends it its browser — the "lent browser" mode.
 *
 * When the MCP client that starts this server is an agent host with a browser of its own (the
 * personas-engine does this: it lends one of its owner's browser identities to this server), the
 * host puts two variables in the environment:
 *
 *   ENGINE_BROWSER_SOCKET  a unix socket path
 *   ENGINE_BROWSER_TOKEN   a secret, new at every start, required on every line
 *
 * and this server runs no Chromium and keeps no cookie: each request is run by the host in a page
 * of its own browser, under the identity it lent, with the host's own rules (allowed hosts, pacing,
 * one hand at a time). JSON lines, one object per line, an `id` per request:
 *
 *   → {"id":1,"token":"…","op":"fetch","req":{"method","url","headers","body"?,"formEntries"?}}
 *   → {"id":2,"token":"…","op":"navigate","url":"…"}
 *   → {"id":3,"token":"…","op":"cookies","origin":"…"}
 *   ← {"id":1,"ok":true,"result":{"status","statusText","url","contentType","cfMitigated","text"}}
 *   ← {"id":2,"ok":true,"result":{"status","url"}}
 *   ← {"id":3,"ok":true,"result":{"names":[…]}}            cookie NAMES only, never a value
 *   ← {"id":n,"ok":false,"error":"<the host's sentence>"}    handed to the tool's caller as it is
 *
 * A line with a wrong token makes the host close the connection without answering. The host's side
 * is `src/adapters/mcp.bridge.ts` in personas-engine; a contract test on each side replays the
 * same lines.
 */
import type { FetchRequest } from './browser.service.js';

export type BridgeOp =
  | { op: 'fetch'; req: FetchRequest }
  | { op: 'navigate'; url: string }
  | { op: 'cookies'; origin: string };

export interface BridgeFetchResult {
  status: number;
  statusText: string;
  url: string;
  contentType: string | null;
  cfMitigated: boolean;
  text: string;
}

export interface BridgeNavigateResult {
  status: number | null;
  url: string;
}

export interface BridgeCookiesResult {
  names: string[];
}

export type BridgeAnswer =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

export function encodeLine(id: number, token: string, op: BridgeOp): string {
  return `${JSON.stringify({ id, token, ...op })}\n`;
}

/** One answer line, or null when the line is not one. */
export function decodeAnswer(line: string): BridgeAnswer | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  if (typeof a.id !== 'number' || typeof a.ok !== 'boolean') return null;
  if (a.ok) return { id: a.id, ok: true, result: a.result };
  return { id: a.id, ok: false, error: typeof a.error === 'string' ? a.error : 'the host refused the request' };
}

/** Whether the server runs in the lent-browser mode. */
export function lentMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.ENGINE_BROWSER_SOCKET;
}
