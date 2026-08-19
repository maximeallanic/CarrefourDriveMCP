# Carrefour Drive MCP — grocery shopping for your AI agent

**MCP server for Carrefour Drive (carrefour.fr).** Let Claude, Cursor, or any
Model Context Protocol client search the French grocery catalogue, build a cart,
pick a Drive pickup or delivery slot, read loyalty points and past receipts — on
your own Carrefour account.

**48 tools.** 43 real `carrefour.fr` API endpoints described as JSON and run by a
generic executor, plus 5 session-management tools. Adding an endpoint means
dropping in a JSON file — no code.

```
"What did I buy last month?"            → get_loyalty_order_receipts
"Refill my usual weekly groceries."     → get_frequent_purchases + add_item_to_cart
"Cheapest organic pasta under 2 €?"     → search_products
"Book the Saturday morning Drive slot." → get_delivery_timeslots + select_cart_delivery_slot
```

- **Standalone** — no `spectral` binary, no external gateway, no API key. Clone, build, run.
- **Cloudflare-proof** — every call is issued from a real Chromium page, because
  nothing else gets a `200`.
- **Stays logged in** — you log in once in a browser window; the server renews the
  session by itself through the OAuth2 SSO loop.

---

## Table of contents

- [Install](#install)
- [Connect it to your agent](#connect-it-to-your-agent) — [Claude Code](#claude-code) · [Claude Desktop](#claude-desktop) · [Cursor, Windsurf, Zed, VS Code](#cursor-windsurf-zed-vs-code-and-other-mcp-clients)
- [Log in](#log-in)
- [Tool reference](#tool-reference)
- [Why a real browser](#why-a-real-browser)
- [How authentication works](#how-authentication-works)
- [How the executor works](#how-the-executor-works)
- [Configuration](#configuration)
- [Verify the install](#verify-the-install)
- [FAQ](#faq)

---

## Install

Node.js **20+** required (native `fetch`, `FormData`, `node:test`).

```sh
git clone https://github.com/maximeallanic/CarrefourDriveMCP.git
cd CarrefourDriveMCP
npm install     # also downloads the Chromium used as HTTP transport
npm run build
```

That's it — `node dist/index.js` starts the MCP server on stdio. Point your
client at that path and you're done.

## Connect it to your agent

### Claude Code

```sh
claude mcp add carrefour-drive -- node /absolute/path/to/CarrefourDriveMCP/dist/index.js
```

Then, in any session:

```
> Log me in to Carrefour        (runs carrefour_browser_login)
> Add 2 L of semi-skimmed milk to my Drive cart
```

### Claude Desktop

Edit `claude_desktop_config.json`:

- **macOS** — `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows** — `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux** — `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "carrefour-drive": {
      "command": "node",
      "args": ["/absolute/path/to/CarrefourDriveMCP/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop; the Carrefour tools appear in the tools menu.

### Cursor, Windsurf, Zed, VS Code and other MCP clients

Any client that speaks MCP over stdio takes the same two fields:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/CarrefourDriveMCP/dist/index.js"]
}
```

- **Cursor** — `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project)
- **Windsurf** — `~/.codeium/windsurf/mcp_config.json`
- **VS Code / Copilot** — `.vscode/mcp.json`, under `"servers"`
- **Zed** — `settings.json`, under `"context_servers"`

Already have cookies? Pass them in an `"env"` block instead of logging in:
`{"CARREFOUR_COOKIES": "…cookie header…"}`.

## Log in

carrefour.fr signs you in with cookies, behind a Cloudflare Turnstile captcha and
an OTP. So the login is interactive, once:

1. Ask your agent to run **`carrefour_browser_login`**.
2. A browser window opens on the Carrefour login page. Type your email, password
   and the OTP code yourself.
3. **Don't close the window** — the server detects the end of the OAuth loop,
   grabs the session cookies from memory and closes it for you.

From then on the session renews itself silently: the server replays the SSO
authorize → callback redirect before authenticated calls, after a `401`/`403`,
and every 30 minutes as a keep-alive. You only log in again when the SSO cookie
itself expires (24 h max, or 60 min idle) — the tools say so explicitly.

Check the state at any time with `carrefour_session_status` (`verify: true` makes
a real call).

| Session tool | What it does |
| --- | --- |
| `carrefour_browser_login` | open a window to sign in (captcha + OTP) |
| `carrefour_session_status` | stored cookies, browser profile, SSO time left |
| `carrefour_refresh_session` | force a renewal (rarely needed — it's automatic) |
| `carrefour_set_cookies` | import cookies manually (header, JSON map, or JSON array) |
| `carrefour_clear_session` | wipe the local session |

> For `carrefour_set_cookies`, only the **JSON array** format carries the cookie
> domain — it's the only one that can supply `c4iamsecuretk`, without which
> automatic renewal is impossible.

The cookie jar lives in `data/sessions/cookies.json` (`0600`) and is re-injected
into the browser profile on every start.

## Tool reference

### Search & catalogue *(no account needed)*

| Tool | Endpoint | Required params |
| --- | --- | --- |
| `search_products` | GET /s | `q` |
| `autocomplete_search` | GET /autocomplete | `q` |
| `get_products_by_gtins` | POST /products | `gtins` |
| `get_products_by_query` | GET /products/query/{query_id} | `query_id` |
| `get_product_reviews` | GET /product/{ean}/reviews | `ean` |
| `get_navigation_tree` | GET /navigation | — |
| `get_marketing_placements` | POST /api/marketing/{placement} | `placement`, `searchTerm`, `categories`, `productFilters` |
| `get_donation_products` | GET /donation | — |
| `get_chat_preprompts` | POST ocb.carrefour.fr/preprompts | `modes`, `count`, `navigationCurrentPageTitle`, `navigationCurrentPageType` |
| `get_eligible_drive_stores` | GET /api/eligibility/drive | `latitude`, `longitude`, `postalCode`, `city` |

### Cart & checkout

| Tool | Endpoint | Required params |
| --- | --- | --- |
| `get_cart` | GET /api/cart | — |
| `add_item_to_cart` | PATCH /api/cart | `ean`, `counter`, `basketServiceId`, `subBasketType` |
| `add_item_to_cart_by_ean` | PATCH /api/cart/items | `ean`, `basketServiceId`, `subBasketType` |
| `apply_promo_code_to_cart` | POST /api/cart/promo_code | `code`, `facilityServiceId`, `subBasketType` |
| `simulate_cart_for_store` | GET /api/cart/simulate | `storeRef` |
| `get_delivery_timeslots` | GET /api/timeslots | `facilityServiceId` |
| `select_cart_delivery_slot` | PUT /api/cart/slot | `slotRef`, `storeRef` |
| `validate_checkout_slot` | POST /api/checkout/{basket_service_type}/validate/slot | `basket_service_type`, `deviceFingerPrintId` |
| `validate_checkout_summary` | POST /api/checkout/{basket_service_type}/validate/summary | `basket_service_type`, `deviceFingerPrintId` |
| `get_checkout_recommendations` | GET /api/checkout/recommendations/{facility_id}/{basket_service} | `facility_id`, `basket_service` |
| `submit_checkout_payment` ⚠️ | POST /api/checkout/payment | `checkout_type`, `device_fingerprint_id`, `payments` |

> ⚠️ `submit_checkout_payment` **charges a real payment**. Four of its parameters
> were captured as query string while their description suggests HTTP headers —
> check against a real trace before using it in production.

### Account, orders & loyalty

| Tool | Endpoint | Required params |
| --- | --- | --- |
| `get_orders` | GET /api/user/orders | — |
| `get_last_orders` | GET /api/user/orders/last | — |
| `get_frequent_purchases` | GET /mon-compte/achats-frequents | — |
| `get_loyalty_balance` | GET /api/user/secured/loyalty/balance | — |
| `get_loyalty_cards` | GET /api/user/secured/loyalty/my-cards | — |
| `get_loyalty_coupons_dashboard` | GET /api/user/loyalty/coupons-dashboard | — |
| `get_loyalty_coupon_collection` | GET /api/user/loyalty/coupon-collection | — |
| `get_loyalty_order_receipts` | GET /api/user/secured/loyalty/orders/receipts | `loyaltyCardNumber`, `loyaltyCardType` |
| `get_loyalty_order_receipt_details` | GET /api/user/secured/loyalty/orders/receipt/{gln}/{date_key}/{receipt_number} | `gln`, `date_key`, `receipt_number` |
| `get_advantage_codes` | GET /api/advantage-code | — |
| `get_vignettes_products` | GET /api/user/products/vignettes-products | — |
| `get_olympic_games_prime` | GET /api/user/loyalty/olympic-games/prime | — |
| `get_account_kpis` | GET /api/user/my-account/kpis | `codes` |
| `get_user_consents` | GET /api/user/my-account/consents | — |
| `get_favorite_store` | GET /api/favoritestore | — |
| `get_store_information_inserts` | POST /api/information-insert/stores/{store_id} | `store_id`, `insert_ids` |
| `get_homepage_returning_banner` | GET /api/homepage/returningBanner | — |
| `get_personalized_recommendations` | GET /api/user/recommendation/cdp | — |
| `get_product_recommendations` | GET /api/recommendations | `context` |

### Shopping lists

| Tool | Endpoint | Required params |
| --- | --- | --- |
| `get_shopping_lists` | GET /api/shopping-lists | — |
| `get_shopping_list` | GET /api/shopping-lists-id/{list_id} | `list_id` |
| `create_shopping_list` | POST /api/shopping-lists/memo-list | `title` |

## Why a real browser

carrefour.fr sits behind a Cloudflare *managed challenge* that fingerprints the
client. Measured from one IP, on the same day:

| Client | `GET /api/cart` |
| --- | --- |
| `fetch` (undici) | `403 cf-mitigated: challenge`, **on the very first request** |
| `curl` | `200` for a few calls, then `403` |
| Chrome | `200` |

No amount of header tweaking changes that: the only viable transport is a
browser. And the requests must be issued **from a page** — Playwright's
`APIRequestContext` uses a Node HTTP stack and gets blocked like `fetch`.

So the server keeps a persistent Chromium and runs every API call as a `fetch`
inside a page parked on the target origin (one page per origin, because of CORS).
It runs **windowless**, but not in standard headless mode:

| Launch mode | Result |
| --- | --- |
| `headless: true` (headless shell) | `403` — the UA announces `HeadlessChrome` |
| `headless: false` | `200` |
| `channel: 'chromium'` + masked UA + `--disable-blink-features=AutomationControlled` | `200`, `navigator.webdriver` is `false` |

The last line is what ships.

## How authentication works

Two distinct cookie systems:

| Domain | Role | Lifetime |
| --- | --- | --- |
| `moncompte.carrefour.fr` | ForgeRock SSO, cookie **`c4iamsecuretk`** | 24 h max, dies after **60 min idle** |
| `www.carrefour.fr` | store session (`HttpOnly` cookies) | short, renewable |

Login is interactive because of two constraints: the form is behind a
**Cloudflare Turnstile** captcha that refuses to validate in a CDP-driven
browser, and `c4iamsecuretk` is a **session cookie** Chromium never writes to
disk. So the window is a plain Chromium with a debug port open but **nothing
attached** until login finishes; the server polls the tab over plain HTTP on
`/json/list` (no CDP domain enabled, so no automation trace), attaches the moment
the OAuth loop lands back on the store, and reads the cookies **from memory**.

Renewal afterwards is a plain navigation — Chromium follows the redirects and
sets the cookies itself:

```
GET moncompte.carrefour.fr/iam/oauth2/CarrefourConnect/authorize?client_id=…&redirect_uri=https://www.carrefour.fr/login/check
  └─302─► www.carrefour.fr/login/check?code=…   (the BFF exchanges the code)
      └─302─► www.carrefour.fr/                  (fresh session cookies)
```

## How the executor works

```
tools/*.json ──► loader (validation) ──► params (JSON Schema ➜ zod) ──► MCP tools/list
                                     └─► resolve ($param ➜ URL/query/headers/body)
                                              └─► http.service (cookies + rate limit + fetch)
```

Every file in `tools/` is self-describing:

```jsonc
{
  "name": "add_item_to_cart",
  "parameters": { "type": "object", "properties": { … }, "required": [ … ] },
  "request": {
    "method": "PATCH",
    "url": "https://www.carrefour.fr/api/cart",
    "headers": { … },
    "query": {},
    "body": { "items": [ { "ean": { "$param": "ean" }, … } ] },
    "content_type": "application/json"
  },
  "requires_auth": true
}
```

The engine (`src/spec/`):

- **recursively substitutes** `{"$param": "name"}` nodes in `headers`, `query`
  and `body`, preserving the original type (number, boolean, array);
- **drops** placeholders with no argument, so optional params vanish from the
  request instead of being sent as `null`;
- **fills URL segments** `{basket_service_type}`, `{store_id}`, … with encoding,
  failing with a clear message when a required segment is missing;
- **serialises arrays** as repeated query keys (`codes[]=14&codes[]=15`);
- **encodes the body** per `content_type`: JSON, `x-www-form-urlencoded` or
  `multipart/form-data` (boundary left to `fetch`);
- applies a **sliding rate limit** with jitter, plus browser headers.

Adding an endpoint = dropping a new JSON file into `tools/`. No code to write.

## Configuration

See `.env.example`. Main variables:

| Variable | Default | Role |
| --- | --- | --- |
| `CARREFOUR_COOKIES` | — | session cookies (header, JSON map or JSON array) |
| `CARREFOUR_COOKIE_FILE` | — | path to a JSON cookie export |
| `CARREFOUR_SESSION_FILE` | `data/sessions/cookies.json` | persisted cookie jar |
| `CARREFOUR_BROWSER_PROFILE` | `data/browser-profile` | persistent Chromium profile |
| `CARREFOUR_KEEPALIVE_MINUTES` | `30` | SSO keep-alive period; `0` disables |
| `CARREFOUR_OAUTH_CLIENT_ID` | `carrefour_onecarrefour_web` | OAuth2 client used for refresh |
| `CARREFOUR_OAUTH_REDIRECT_URI` | `https://www.carrefour.fr/login/check` | BFF callback |
| `CARREFOUR_OAUTH_SCOPE` | `openid iam` | requested scopes |
| `CARREFOUR_TOOLS_DIR` | `<project>/tools` | JSON tool definitions directory |
| `CARREFOUR_MAX_RESPONSE_CHARS` | `60000` | truncation of large responses |
| `REQUEST_TIMEOUT_MS` | `30000` | HTTP timeout |
| `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW_MS` | `10` / `60000` | rate-limit window |
| `MIN_DELAY_MS` / `MAX_DELAY_MS` | `100` / `500` | jitter between requests |
| `LOG_LEVEL`, `CARREFOUR_LOG_DIR` | `info`, `data/` | winston logs (files + stderr, **never stdout**) |

## Verify the install

```sh
npm run build     # tsc
npm test          # build + unit tests (node:test)
npm run smoke     # build + real MCP stdio handshake + tools/list
npm run verify    # all three
```

Tests cover `$param` substitution, URL segments, arrays in query strings, the
three body encodings, and cookie-jar handling. The smoke test actually boots the
server, performs the JSON-RPC handshake and lists the tools.

> Network calls to carrefour.fr are **not** tested automatically — they need a
> real account and valid cookies.

## FAQ

**Do I need an API key?** No. Carrefour has no public API; this server drives the
same private endpoints the website uses, with your own session.

**Does it work outside France?** The catalogue and stores are French
(carrefour.fr). Cloudflare may be stricter from some IPs.

**Is my password stored?** No. You type it in a browser window; only cookies are
persisted, in `data/sessions/cookies.json` with `0600` permissions. No credential
lives in this repo, and `data/` and `.env` are gitignored.

**Can it place a real order?** Yes — `submit_checkout_payment` charges a real
payment. Treat it accordingly.

**Can I add endpoints?** Drop a JSON file in `tools/`. See
[How the executor works](#how-the-executor-works).

**Which clients are supported?** Anything speaking MCP over stdio: Claude Code,
Claude Desktop, Cursor, Windsurf, VS Code / Copilot, Zed, Continue, custom agents
using the MCP SDK.

## Disclaimer

Unofficial project, not affiliated with, endorsed by, or supported by Carrefour.
For personal and educational use on your own account. Respect Carrefour's terms
of service and rate-limit yourself accordingly.

## License

MIT © Maxime Allanic

---

<sub>Keywords: Carrefour MCP server · Carrefour Drive API · Model Context
Protocol grocery · Claude Desktop MCP · Claude Code MCP server · Cursor MCP ·
French grocery shopping AI agent · courses en ligne · drive · liste de courses ·
fidélité Carrefour · MCP shopping cart automation.</sub>
