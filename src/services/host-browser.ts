import { connect, type Socket } from 'net';
import type { FetchRequest, FetchResponse } from './browser.service.js';
import {
  decodeAnswer,
  encodeLine,
  type BridgeCookiesResult,
  type BridgeFetchResult,
  type BridgeNavigateResult,
  type BridgeOp,
} from './bridge.protocol.js';

/**
 * The browser of the lent-browser mode: the same interface as `BrowserService`, but every request
 * is run by the host in a page of its own browser (`bridge.protocol.ts`). It never loads
 * `playwright` and keeps no cookie: `syncCookies` does nothing, and the session is the host's.
 *
 * One connection, opened at the first request and multiplexed by `id`. A refusal of the host
 * (an off-host url, its pacing, an identity not lent) rejects with the host's own sentence, which
 * the tool hands back to its caller as it is.
 */
export class HostBrowser {
  private socket: Socket | null = null;
  private connecting: Promise<Socket> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = '';

  constructor(private readonly path: string, private readonly token: string) {}

  isRunning(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  async fetch(request: FetchRequest): Promise<FetchResponse> {
    const r = (await this.call({ op: 'fetch', req: request })) as BridgeFetchResult;
    return {
      status: r.status,
      statusText: r.statusText,
      ok: r.status >= 200 && r.status < 300,
      url: r.url,
      contentType: r.contentType,
      text: r.text,
    };
  }

  async navigate(url: string): Promise<{ status: number | null; finalUrl: string }> {
    const r = (await this.call({ op: 'navigate', url })) as BridgeNavigateResult;
    return { status: r.status, finalUrl: r.url };
  }

  /** The NAMES of the cookies the host holds for an origin — never a value. */
  async cookieNames(origin: string): Promise<string[]> {
    return ((await this.call({ op: 'cookies', origin })) as BridgeCookiesResult).names;
  }

  /** The cookies are the host's: nothing to mirror. */
  async syncCookies(): Promise<void> {}

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (socket) socket.destroy();
  }

  describe(): { running: boolean; headed: boolean; profile: string } {
    return { running: this.isRunning(), headed: false, profile: 'lent by host' };
  }

  private async call(op: BridgeOp): Promise<unknown> {
    const socket = await this.open();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      socket.write(encodeLine(id, this.token, op));
    });
  }

  private open(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (!this.connecting) {
      this.connecting = new Promise<Socket>((resolve, reject) => {
        const socket = connect(this.path);
        socket.once('connect', () => {
          this.socket = socket;
          resolve(socket);
        });
        socket.once('error', reject);
        socket.on('data', (chunk) => this.read(chunk.toString('utf8')));
        socket.on('close', () => this.lost(socket));
      }).finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const answer = decodeAnswer(this.buffer.slice(0, i));
      this.buffer = this.buffer.slice(i + 1);
      if (!answer) continue;
      const waiting = this.pending.get(answer.id);
      if (!waiting) continue;
      this.pending.delete(answer.id);
      if (answer.ok) waiting.resolve(answer.result);
      else waiting.reject(new Error(answer.error));
    }
  }

  /** The host closed the connection (a stop, or a token it refused): every request in flight fails. */
  private lost(socket: Socket): void {
    if (this.socket === socket) this.socket = null;
    this.buffer = '';
    for (const [, waiting] of this.pending) waiting.reject(new Error('the host closed the browser bridge'));
    this.pending.clear();
  }
}

let shared: HostBrowser | null = null;

/** The process's HostBrowser, from ENGINE_BROWSER_SOCKET / ENGINE_BROWSER_TOKEN. */
export function hostBrowser(env: NodeJS.ProcessEnv = process.env): HostBrowser {
  if (!shared) shared = new HostBrowser(env.ENGINE_BROWSER_SOCKET ?? '', env.ENGINE_BROWSER_TOKEN ?? '');
  return shared;
}
