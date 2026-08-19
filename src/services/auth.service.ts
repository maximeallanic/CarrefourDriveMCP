import { CARREFOUR_ORIGIN, IAM_ORIGIN, SessionService, sessionService } from './session.service.js';
import { browserService } from './browser.service.js';
import { logger } from '../utils/logger.js';

/**
 * Carrefour authentication, as observed on the live site.
 *
 * Logging in goes through ForgeRock AM (`moncompte.carrefour.fr/iam`) and ends
 * with two independent sessions:
 *
 *   1. the IAM SSO session, carried by the `c4iamsecuretk` cookie on
 *      `moncompte.carrefour.fr` — max 24 h, and killed after 60 min idle;
 *   2. the storefront session, carried by httpOnly cookies on
 *      `www.carrefour.fr`, which the BFF mints from an OAuth2 authorization
 *      code.
 *
 * Only step 1 needs a human: it is gated by a Cloudflare Turnstile captcha and
 * an email OTP. Step 2 is a plain redirect chain, so as long as the SSO cookie
 * is alive the storefront session can be rebuilt headlessly — that is what
 * `refreshSession()` does, and it is our equivalent of a refresh token.
 */

const CLIENT_ID = process.env.CARREFOUR_OAUTH_CLIENT_ID || 'carrefour_onecarrefour_web';
const REDIRECT_URI = process.env.CARREFOUR_OAUTH_REDIRECT_URI || `${CARREFOUR_ORIGIN}/login/check`;
const SCOPE = process.env.CARREFOUR_OAUTH_SCOPE || 'openid iam';
export function authorizeUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
  });
  return `${IAM_ORIGIN}/iam/oauth2/CarrefourConnect/authorize?${params.toString()}`;
}

export type RefreshFailure = 'no-sso' | 'sso-expired' | 'network';

export interface RefreshResult {
  ok: boolean;
  reason?: RefreshFailure;
  message: string;
}

/**
 * Landing back on the storefront means the whole chain went through:
 * authorize -> /login/check?code=... -> www. Being left on the IAM host means
 * ForgeRock asked for credentials instead, i.e. the SSO session is gone.
 */
function landedOnStorefront(finalUrl: string): boolean {
  try {
    return new URL(finalUrl).origin === CARREFOUR_ORIGIN;
  } catch {
    return false;
  }
}

async function doRefresh(session: SessionService): Promise<RefreshResult> {
  if (!session.hasSso()) {
    return {
      ok: false,
      reason: 'no-sso',
      message:
        'No IAM SSO cookie (c4iamsecuretk) in the browser profile, so the storefront session ' +
        'cannot be rebuilt. Run carrefour_browser_login to sign in again.',
    };
  }

  let landing: { status: number | null; finalUrl: string };
  try {
    // Chromium walks the redirect chain and stores the cookies itself.
    landing = await browserService.navigate(authorizeUrl());
  } catch (error) {
    logger.error('Session refresh failed', { error: String(error) });
    return { ok: false, reason: 'network', message: `Session refresh failed: ${(error as Error).message}` };
  }

  if (!landedOnStorefront(landing.finalUrl)) {
    logger.error('Session refresh stopped short of the storefront', { finalUrl: landing.finalUrl });
    return {
      ok: false,
      reason: 'sso-expired',
      message:
        'The IAM SSO session is no longer valid (it expires after 60 min idle, 24 h max), so no ' +
        'authorization code was issued. Sign in again with carrefour_browser_login — Carrefour ' +
        'requires a captcha and an email OTP, which cannot be scripted.',
    };
  }

  session.persist();
  logger.info('Session refreshed', { finalUrl: landing.finalUrl, status: landing.status });
  return { ok: true, message: 'Storefront session refreshed from the IAM SSO cookie.' };
}

let inFlight: Promise<RefreshResult> | null = null;

/**
 * Rebuild the storefront session from the SSO cookie. Concurrent callers share
 * one round-trip: a burst of 401s must not trigger a burst of re-authentications.
 */
export function refreshSession(session: SessionService = sessionService): Promise<RefreshResult> {
  if (!inFlight) {
    inFlight = doRefresh(session).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export interface SsoStatus {
  present: boolean;
  /** Seconds before the SSO session dies of old age, when the server tells us. */
  secondsLeft?: number;
  /** Idle timeout in minutes, after which the SSO session dies early. */
  maxIdleMinutes?: number;
  error?: string;
}

/** Ask ForgeRock how much life is left in the SSO session. */
export async function ssoStatus(session: SessionService = sessionService): Promise<SsoStatus> {
  if (!session.hasSso()) return { present: false };

  const call = async (action: string): Promise<Record<string, number> | null> => {
    const response = await browserService.fetch({
      method: 'POST',
      url: `${IAM_ORIGIN}/iam/json/sessions/?_action=${action}`,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'accept-api-version': 'resource=1.1',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: '{}',
    });
    if (!response.ok) return null;
    try {
      return JSON.parse(response.text) as Record<string, number>;
    } catch {
      return null;
    }
  };

  try {
    const [timeLeft, maxIdle] = await Promise.all([call('getTimeLeft'), call('getMaxIdle')]);
    return {
      present: true,
      secondsLeft: timeLeft?.maxtime,
      maxIdleMinutes: maxIdle?.maxidletime,
    };
  } catch (error) {
    return { present: true, error: (error as Error).message };
  }
}

let keepAliveTimer: NodeJS.Timeout | null = null;

/**
 * The SSO session dies after 60 min of inactivity, which a long-lived MCP
 * server would otherwise hit constantly. Replaying the OAuth chain on a timer
 * touches the SSO session *and* keeps the storefront cookies fresh.
 *
 * Set CARREFOUR_KEEPALIVE_MINUTES=0 to opt out.
 */
export function startKeepAlive(session: SessionService = sessionService): void {
  const minutes = parseInt(process.env.CARREFOUR_KEEPALIVE_MINUTES || '30', 10);
  if (!Number.isFinite(minutes) || minutes <= 0 || keepAliveTimer) return;

  keepAliveTimer = setInterval(() => {
    if (!session.hasSso()) return;
    refreshSession(session)
      .then((result) => logger.info('Keep-alive', { ok: result.ok, reason: result.reason }))
      .catch((error) => logger.error('Keep-alive failed', { error: String(error) }));
  }, minutes * 60_000);

  // Never hold the process open just for the keep-alive.
  keepAliveTimer.unref?.();
}

export function stopKeepAlive(): void {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}
