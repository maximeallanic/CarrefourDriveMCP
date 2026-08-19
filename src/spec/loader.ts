import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { ToolSpec, HttpMethod } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const VALID_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

export interface LoadFailure {
  file: string;
  reason: string;
}

export interface LoadResult {
  specs: ToolSpec[];
  failures: LoadFailure[];
  dir: string;
}

/**
 * Locate the directory holding the JSON tool definitions.
 * Works both from `src/` (ts-node/tsx) and from `dist/` (compiled).
 */
export function resolveToolsDir(): string {
  if (process.env.CARREFOUR_TOOLS_DIR) {
    return resolve(process.env.CARREFOUR_TOOLS_DIR);
  }
  const candidates = [
    join(__dirname, '..', '..', 'tools'), // dist/spec -> <root>/tools  |  src/spec -> <root>/tools
    join(__dirname, '..', '..', '..', 'tools'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

/** Validate the parts of a spec this executor actually relies on. */
export function validateSpec(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'not a JSON object';
  const spec = raw as Partial<ToolSpec>;
  if (typeof spec.name !== 'string' || !spec.name) return 'missing "name"';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(spec.name)) return `invalid tool name "${spec.name}"`;
  if (typeof spec.description !== 'string') return 'missing "description"';
  if (typeof spec.request !== 'object' || spec.request === null) return 'missing "request"';
  const req = spec.request;
  if (!VALID_METHODS.includes(req.method)) return `unsupported method "${req.method}"`;
  if (typeof req.url !== 'string' || !/^https?:\/\//.test(req.url)) {
    return `invalid url "${req.url}"`;
  }
  if (spec.parameters && spec.parameters.type !== 'object') {
    return 'parameters schema must be of type "object"';
  }
  return null;
}

/** Load every `*.json` tool definition from disk, reporting per-file failures. */
export function loadToolSpecs(dir: string = resolveToolsDir()): LoadResult {
  const failures: LoadFailure[] = [];
  const specs: ToolSpec[] = [];
  const seen = new Set<string>();

  if (!existsSync(dir)) {
    return { specs, failures: [{ file: dir, reason: 'tools directory not found' }], dir };
  }

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const full = join(dir, file);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(full, 'utf8'));
    } catch (err) {
      failures.push({ file, reason: `invalid JSON: ${(err as Error).message}` });
      continue;
    }
    const problem = validateSpec(raw);
    if (problem) {
      failures.push({ file, reason: problem });
      continue;
    }
    const spec = raw as ToolSpec;
    if (seen.has(spec.name)) {
      failures.push({ file, reason: `duplicate tool name "${spec.name}"` });
      continue;
    }
    seen.add(spec.name);
    specs.push(spec);
  }

  return { specs, failures, dir };
}
