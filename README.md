# Carrefour Drive MCP

Serveur **MCP autonome** pour l'API privée de **Carrefour Drive** (`www.carrefour.fr`).

48 outils exposés : **43 endpoints** décrits dans `tools/*.json` (extraits de trafic réel)
et exécutés par un **moteur générique**, plus 5 outils de gestion de session.

> **Spectral n'est plus requis.** Les anciennes versions de ce projet passaient par le binaire
> externe `spectral` (`spectral mcp stdio`, `spectral auth login`) pour interpréter les
> définitions d'outils. Ce dépôt embarque désormais son propre exécuteur : `npm install &&
> npm run build && node dist/index.js` suffit. Playwright, en revanche, est désormais une
> dépendance **obligatoire** : c'est le transport, pas un confort — voir
> [Transport](#transport--tout-passe-par-un-vrai-chromium).

## Installation

```sh
git clone git@github.com:maximeallanic/CarrefourDriveMCP.git
cd CarrefourDriveMCP
npm install
npm run build
node dist/index.js   # démarre le serveur MCP en stdio
```

Node >= 20 (utilise `fetch`, `FormData` et `node:test` natifs).

### Brancher sur un client MCP

**Claude Code**

```sh
claude mcp add carrefour-drive -- node /chemin/absolu/CarrefourDriveMCP/dist/index.js
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "carrefour-drive": {
      "command": "node",
      "args": ["/chemin/absolu/CarrefourDriveMCP/dist/index.js"],
      "env": {
        "CARREFOUR_COOKIES": "…votre cookie header…"
      }
    }
  }
}
```

## Transport : tout passe par un vrai Chromium

carrefour.fr est protégé par un *managed challenge* Cloudflare qui prend les empreintes du
client. Mesuré depuis une même IP, le même jour :

| Client | `GET /api/cart` |
| --- | --- |
| `fetch` (undici) | `403 cf-mitigated: challenge`, **dès la première requête** |
| `curl` | `200` quelques appels, puis `403` |
| Chrome | `200` |

Aucun bricolage d'en-têtes n'y change quoi que ce soit : le seul transport viable est un
navigateur. Et les requêtes doivent être émises **depuis une page** — l'`APIRequestContext`
de Playwright utilise une pile HTTP Node et se fait bloquer comme `fetch`.

Le serveur maintient donc un Chromium persistant et exécute chaque appel d'API en `fetch`
dans une page garée sur l'origine visée (une page par origine, CORS oblige). Il tourne
**sans fenêtre**, mais pas en mode headless standard :

| Lancement | Résultat |
| --- | --- |
| `headless: true` (headless shell) | `403` — l'UA annonce `HeadlessChrome` |
| `headless: false` | `200` |
| `channel: 'chromium'` + UA masqué + `--disable-blink-features=AutomationControlled` | `200`, `navigator.webdriver` à `false` |

C'est la dernière ligne qui est utilisée.

## Authentification

carrefour.fr s'authentifie par cookies, derrière deux systèmes distincts :

| Domaine | Rôle | Durée de vie |
| --- | --- | --- |
| `moncompte.carrefour.fr` | SSO ForgeRock, cookie **`c4iamsecuretk`** | 24 h max, meurt après **60 min d'inactivité** |
| `www.carrefour.fr` | session boutique (cookies `HttpOnly`) | courte, renouvelable |

### Se connecter

`carrefour_browser_login` ouvre une fenêtre que **vous** pilotez, puis récupère la session.
Deux contraintes en dictent le fonctionnement :

- le formulaire est derrière un captcha **Cloudflare Turnstile**, qui refuse de se valider
  dans un navigateur piloté par CDP — la fenêtre est donc un Chromium ordinaire, avec un
  port de debug ouvert mais **rien d'attaché** tant que le login n'est pas terminé ;
- `c4iamsecuretk` est un cookie **de session** : Chromium ne l'écrit jamais sur disque, et
  les cookies qu'il persiste sont chiffrés avec une clé du trousseau système qu'un autre
  lancement ne retrouve pas forcément. Attendre la fermeture de la fenêtre détruirait donc
  précisément ce qu'on cherche à capturer.

Le serveur surveille l'onglet via une simple requête HTTP sur `/json/list` (aucun domaine
CDP activé, donc aucune trace d'automatisation), et dès que la boucle OAuth retombe sur la
boutique, il s'attache, lit les cookies **en mémoire** et les range dans le jar persistant.
Il ferme la fenêtre lui-même : **ne la fermez pas**.

Le jar `tough-cookie` (`data/sessions/cookies.json`, permissions `0600`) est le stockage
durable de la session ; il réinjecte tout dans le profil du navigateur à chaque démarrage.

### Renouvellement automatique

Tant que le cookie SSO vit, la session boutique se reconstruit sans aucune interaction :

```
GET moncompte.carrefour.fr/iam/oauth2/CarrefourConnect/authorize?client_id=…&redirect_uri=https://www.carrefour.fr/login/check
  └─302─► www.carrefour.fr/login/check?code=…   (le BFF échange le code)
      └─302─► www.carrefour.fr/                  (nouveaux cookies de session)
```

C'est une simple navigation : Chromium suit les redirections et pose les cookies lui-même.
Le serveur la déclenche **tout seul** :

- avant une requête authentifiée s'il n'a aucun cookie boutique utilisable ;
- après un `401`/`403`, en rejouant la requête une fois ;
- toutes les 30 min via un keep-alive, sans quoi les 60 min d'inactivité du SSO tueraient
  la session entre deux sollicitations (`CARREFOUR_KEEPALIVE_MINUTES=0` pour désactiver).

Quand le SSO lui-même a expiré, aucune reconnexion silencieuse n'est possible : les outils
renvoient une erreur explicite demandant un nouveau `carrefour_browser_login`.

### Outils de session

| Outil | Rôle |
| --- | --- |
| `carrefour_browser_login` | ouvrir une fenêtre pour se connecter (captcha + OTP) |
| `carrefour_session_status` | cookies stockés, profil navigateur, durée de vie restante du SSO ; `verify: true` fait un appel réel |
| `carrefour_refresh_session` | forcer un renouvellement (rarement utile : c'est automatique) |
| `carrefour_set_cookies` | importer des cookies à la main (header, JSON map, ou tableau JSON) |
| `carrefour_clear_session` | effacer la session locale |

Pour `carrefour_set_cookies`, seul le format tableau JSON transporte le domaine : c'est le
seul utilisable pour fournir `c4iamsecuretk`, sans lequel le renouvellement automatique est
impossible.

## Comment ça marche

```
tools/*.json ──► loader (validation) ──► params (JSON Schema ➜ zod) ──► MCP tools/list
                                     └─► resolve ($param ➜ URL/query/headers/body)
                                              └─► http.service (cookies + rate limit + fetch)
```

Chaque fichier de `tools/` est auto-descriptif :

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

Le moteur (`src/spec/`) :

- **substitue récursivement** les nœuds `{"$param": "nom"}` dans `headers`, `query` et `body`,
  en conservant le type d'origine (nombre, booléen, tableau) ;
- **supprime** les placeholders sans argument, pour que les paramètres optionnels
  n'apparaissent pas du tout dans la requête au lieu d'être envoyés à `null` ;
- **remplace les segments d'URL** `{basket_service_type}`, `{store_id}`, … avec encodage,
  et échoue avec un message clair si un segment requis manque ;
- **sérialise les tableaux** en clés répétées dans la query (`codes[]=14&codes[]=15`) ;
- **encode le corps** selon `content_type` : JSON, `x-www-form-urlencoded` ou
  `multipart/form-data` (le boundary étant laissé à `fetch`) ;
- applique un **rate limit glissant** avec jitter (configurable) et les en-têtes de navigateur.

Ajouter un endpoint = déposer un nouveau fichier JSON dans `tools/`. Aucun code à écrire.

## Configuration

Voir `.env.example`. Variables principales :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `CARREFOUR_COOKIES` | — | cookies de session (header, JSON map ou JSON array) |
| `CARREFOUR_COOKIE_FILE` | — | chemin d'un export JSON de cookies |
| `CARREFOUR_SESSION_FILE` | `data/sessions/cookies.json` | emplacement du jar persisté |
| `CARREFOUR_BROWSER_PROFILE` | `data/browser-profile` | profil Chromium persistant |
| `CARREFOUR_KEEPALIVE_MINUTES` | `30` | période du keep-alive SSO ; `0` désactive |
| `CARREFOUR_OAUTH_CLIENT_ID` | `carrefour_onecarrefour_web` | client OAuth2 utilisé pour le refresh |
| `CARREFOUR_OAUTH_REDIRECT_URI` | `https://www.carrefour.fr/login/check` | callback du BFF |
| `CARREFOUR_OAUTH_SCOPE` | `openid iam` | scopes demandés |
| `CARREFOUR_TOOLS_DIR` | `<projet>/tools` | dossier des définitions JSON |
| `CARREFOUR_MAX_RESPONSE_CHARS` | `60000` | troncature des réponses volumineuses |
| `REQUEST_TIMEOUT_MS` | `30000` | timeout HTTP |
| `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW_MS` | `10` / `60000` | fenêtre de rate limit |
| `MIN_DELAY_MS` / `MAX_DELAY_MS` | `100` / `500` | jitter entre requêtes |
| `LOG_LEVEL`, `CARREFOUR_LOG_DIR` | `info`, `data/` | logs winston (fichiers + stderr, **jamais stdout**) |

## Vérification

```sh
npm run build     # tsc
npm test          # build + tests unitaires (node:test)
npm run smoke     # build + handshake MCP stdio réel + tools/list
npm run verify    # les trois
```

Les tests couvrent la substitution des `$param`, les segments d'URL, les tableaux en query,
les trois encodages de corps, et la gestion du jar de cookies. Le smoke test démarre
réellement le serveur, fait le handshake JSON-RPC et liste les outils.

> Les appels réseau vers carrefour.fr ne sont **pas** testés automatiquement : ils exigent
> un compte et des cookies valides.

## Outils

| Outil | Endpoint | Auth | Paramètres requis |
| --- | --- | --- | --- |
| `add_item_to_cart` | PATCH /api/cart | yes | `ean`, `counter`, `basketServiceId`, `subBasketType` |
| `add_item_to_cart_by_ean` | PATCH /api/cart/items | yes | `ean`, `basketServiceId`, `subBasketType` |
| `apply_promo_code_to_cart` | POST /api/cart/promo_code | yes | `code`, `facilityServiceId`, `subBasketType` |
| `autocomplete_search` | GET /autocomplete | no | `q` |
| `create_shopping_list` | POST /api/shopping-lists/memo-list | yes | `title` |
| `get_account_kpis` | GET /api/user/my-account/kpis | yes | `codes` |
| `get_advantage_codes` | GET /api/advantage-code | yes | — |
| `get_cart` | GET /api/cart | yes | — |
| `get_chat_preprompts` | POST https://ocb.carrefour.fr/preprompts | no | `modes`, `count`, `navigationCurrentPageTitle`, `navigationCurrentPageType` |
| `get_checkout_recommendations` | GET /api/checkout/recommendations/{facility_id}/{basket_service} | yes | `facility_id`, `basket_service` |
| `get_delivery_timeslots` | GET /api/timeslots | yes | `facilityServiceId` |
| `get_donation_products` | GET /donation | no | — |
| `get_eligible_drive_stores` | GET /api/eligibility/drive | no | `latitude`, `longitude`, `postalCode`, `city` |
| `get_favorite_store` | GET /api/favoritestore | yes | — |
| `get_frequent_purchases` | GET /mon-compte/achats-frequents | yes | — |
| `get_homepage_returning_banner` | GET /api/homepage/returningBanner | yes | — |
| `get_last_orders` | GET /api/user/orders/last | yes | — |
| `get_loyalty_balance` | GET /api/user/secured/loyalty/balance | yes | — |
| `get_loyalty_cards` | GET /api/user/secured/loyalty/my-cards | yes | — |
| `get_loyalty_coupon_collection` | GET /api/user/loyalty/coupon-collection | yes | — |
| `get_loyalty_coupons_dashboard` | GET /api/user/loyalty/coupons-dashboard | yes | — |
| `get_loyalty_order_receipt_details` | GET /api/user/secured/loyalty/orders/receipt/{gln}/{date_key}/{receipt_number} | yes | `gln`, `date_key`, `receipt_number` |
| `get_loyalty_order_receipts` | GET /api/user/secured/loyalty/orders/receipts | yes | `loyaltyCardNumber`, `loyaltyCardType` |
| `get_marketing_placements` | POST /api/marketing/{placement} | no | `placement`, `searchTerm`, `categories`, `productFilters` |
| `get_navigation_tree` | GET /navigation | no | — |
| `get_olympic_games_prime` | GET /api/user/loyalty/olympic-games/prime | yes | — |
| `get_orders` | GET /api/user/orders | yes | — |
| `get_personalized_recommendations` | GET /api/user/recommendation/cdp | yes | — |
| `get_product_recommendations` | GET /api/recommendations | yes | `context` |
| `get_product_reviews` | GET /product/{ean}/reviews | no | `ean` |
| `get_products_by_gtins` | POST /products | no | `gtins` |
| `get_products_by_query` | GET /products/query/{query_id} | yes | `query_id` |
| `get_shopping_list` | GET /api/shopping-lists-id/{list_id} | yes | `list_id` |
| `get_shopping_lists` | GET /api/shopping-lists | yes | — |
| `get_store_information_inserts` | POST /api/information-insert/stores/{store_id} | yes | `store_id`, `insert_ids` |
| `get_user_consents` | GET /api/user/my-account/consents | yes | — |
| `get_vignettes_products` | GET /api/user/products/vignettes-products | yes | — |
| `search_products` | GET /s | no | `q` |
| `select_cart_delivery_slot` | PUT /api/cart/slot | yes | `slotRef`, `storeRef` |
| `simulate_cart_for_store` | GET /api/cart/simulate | yes | `storeRef` |
| `submit_checkout_payment` | POST /api/checkout/payment | yes | `checkout_type`, `device_fingerprint_id`, `payments` |
| `validate_checkout_slot` | POST /api/checkout/{basket_service_type}/validate/slot | yes | `basket_service_type`, `deviceFingerPrintId` |
| `validate_checkout_summary` | POST /api/checkout/{basket_service_type}/validate/summary | yes | `basket_service_type`, `deviceFingerPrintId` |

## Notes

- `submit_checkout_payment` : quatre paramètres (`checkout-type`, `device-fingerprint-id`,
  `apple-pay`, `google-pay`) ont été capturés en query string alors que la description
  suggère des en-têtes HTTP — à vérifier contre une trace réelle avant tout usage en
  production. **Cet outil déclenche un vrai paiement.**
- `get_chat_preprompts` pointe sur `ocb.carrefour.fr`, pas sur `www.carrefour.fr`.
- Aucun credential n'est présent dans ce dépôt ; `data/` et `.env` sont ignorés par git.
- Usage personnel / éducatif sur votre propre compte. Respectez les CGU de Carrefour.

## Licence

MIT
