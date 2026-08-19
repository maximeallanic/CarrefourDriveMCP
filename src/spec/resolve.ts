import type { BuiltRequest, RequestSpec, Template, ToolSpec } from './types.js';

/** Sentinel marking "this placeholder had no matching argument". */
export const MISSING = Symbol('missing-param');

export type Resolved = unknown | typeof MISSING;

function isParamRef(value: unknown): value is { $param: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { $param?: unknown }).$param === 'string'
  );
}

/**
 * Recursively replace every `{"$param": "name"}` node by the matching argument.
 *
 * Placeholders with no argument (optional parameters) collapse to `MISSING`;
 * containers drop those entries so optional fields simply disappear from the
 * outgoing payload instead of being sent as `null`.
 */
export function substitute(template: Template, args: Record<string, unknown>): Resolved {
  if (isParamRef(template)) {
    const value = args[template.$param];
    return value === undefined ? MISSING : value;
  }

  if (Array.isArray(template)) {
    const out: unknown[] = [];
    for (const item of template) {
      const resolved = substitute(item, args);
      if (resolved !== MISSING) out.push(resolved);
    }
    return out;
  }

  if (typeof template === 'object' && template !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      const resolved = substitute(value, args);
      if (resolved !== MISSING) out[key] = resolved;
    }
    return out;
  }

  return template;
}

/** Replace `{segment}` placeholders in a URL path with encoded argument values. */
export function substituteUrl(url: string, args: Record<string, unknown>): string {
  return url.replace(/\{([^{}]+)\}/g, (_match, name: string) => {
    const value = args[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required URL path parameter "${name}" for ${url}`);
    }
    return encodeURIComponent(String(value));
  });
}

function scalarToQueryValue(value: unknown): string {
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

/** Build the query string. Array values are appended as repeated keys. */
export function buildQuery(
  query: Record<string, Template> | undefined,
  args: Record<string, unknown>
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, template] of Object.entries(query ?? {})) {
    const value = substitute(template, args);
    if (value === MISSING || value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        params.append(key, scalarToQueryValue(item));
      }
    } else {
      params.append(key, scalarToQueryValue(value));
    }
  }
  return params;
}

function buildHeaders(
  headers: Record<string, Template> | undefined,
  args: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, template] of Object.entries(headers ?? {})) {
    const value = substitute(template, args);
    if (value === MISSING || value === undefined || value === null) continue;
    out[key.toLowerCase()] = scalarToQueryValue(value);
  }
  return out;
}

function encodeBody(
  spec: RequestSpec,
  args: Record<string, unknown>
): { body?: string | FormData; contentType?: string } {
  const method = spec.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return {};
  if (spec.body === undefined || spec.body === null) return {};

  const resolved = substitute(spec.body, args);
  if (resolved === MISSING) return {};

  const contentType = spec.content_type ?? 'application/json';

  if (contentType.startsWith('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries((resolved ?? {}) as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) value.forEach((v) => params.append(key, scalarToQueryValue(v)));
      else params.append(key, scalarToQueryValue(value));
    }
    return { body: params.toString(), contentType: 'application/x-www-form-urlencoded' };
  }

  if (contentType.startsWith('multipart/form-data')) {
    const form = new FormData();
    for (const [key, value] of Object.entries((resolved ?? {}) as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) value.forEach((v) => form.append(key, scalarToQueryValue(v)));
      else form.append(key, scalarToQueryValue(value));
    }
    // Let fetch set the multipart boundary itself.
    return { body: form };
  }

  return { body: JSON.stringify(resolved), contentType: 'application/json' };
}

/**
 * Turn a tool spec plus its call arguments into a concrete HTTP request.
 * Pure function — no network, no session. That makes it directly unit-testable.
 */
export function buildRequest(spec: ToolSpec, args: Record<string, unknown>): BuiltRequest {
  const req = spec.request;
  const url = new URL(substituteUrl(req.url, args));

  const query = buildQuery(req.query, args);
  for (const [key, value] of query.entries()) {
    url.searchParams.append(key, value);
  }

  const headers = buildHeaders(req.headers, args);
  const { body, contentType } = encodeBody(req, args);

  if (body === undefined) {
    // No payload: a stale content-type header would confuse the API.
    delete headers['content-type'];
  } else if (contentType) {
    headers['content-type'] = contentType;
  } else {
    // multipart: boundary is generated by fetch, so never pin the header.
    delete headers['content-type'];
  }

  return { method: req.method.toUpperCase() as BuiltRequest['method'], url: url.toString(), headers, body };
}
