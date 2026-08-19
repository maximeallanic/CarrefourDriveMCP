import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** <pkg>/dist/utils -> <pkg>  |  <pkg>/src/utils -> <pkg> */
const PACKAGE_ROOT = join(__dirname, '..', '..');

/**
 * Where the session jar, the browser profile and the logs live.
 *
 * Installed from npm or run through `npx`, the package sits in a cache the
 * user does not own and npm may wipe between runs — writing the session there
 * would mean logging in again after every update. So the default is the user's
 * home. A source checkout keeps its own `data/` (that is what `.gitignore`
 * covers), which also preserves the sessions of anyone who cloned the repo.
 */
export function dataDir(): string {
  if (process.env.CARREFOUR_DATA_DIR) return resolve(process.env.CARREFOUR_DATA_DIR);

  const local = join(PACKAGE_ROOT, 'data');
  if (existsSync(local) || existsSync(join(PACKAGE_ROOT, 'src'))) return local;

  const xdg = process.env.XDG_DATA_HOME;
  return xdg
    ? join(resolve(xdg), 'carrefour-drive-mcp')
    : join(homedir(), '.carrefour-drive-mcp');
}

export function dataPath(...segments: string[]): string {
  return join(dataDir(), ...segments);
}
