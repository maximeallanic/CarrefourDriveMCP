# Carrefour Drive MCP

Serveur **MCP autonome** pour l'API privée de **Carrefour Drive** (`www.carrefour.fr`).

46 outils exposés : **43 endpoints** décrits dans `tools/*.json` (extraits de trafic réel)
et exécutés par un **moteur générique**, plus 3 outils de gestion de session.

> **Spectral n'est plus requis.** Les anciennes versions de ce projet passaient par le binaire
> externe `spectral` (`spectral mcp stdio`, `spectral auth login`) pour interpréter les
> définitions d'outils. Ce dépôt embarque désormais son propre exécuteur : `npm install &&
> npm run build && node dist/index.js` suffit. **Playwright n'est pas requis non plus** —
> c'est une dépendance optionnelle utilisée uniquement si vous voulez un login navigateur.

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

## Authentification

L'API de carrefour.fr s'authentifie **par cookies de session**. Il n'y a pas de clé d'API :
vous devez fournir vos propres cookies, obtenus depuis un navigateur où vous êtes connecté.

### Récupérer ses cookies

1. Connectez-vous sur <https://www.carrefour.fr> et sélectionnez votre magasin Drive.
2. Ouvrez les DevTools (`F12`) → onglet **Application** (Chrome) ou **Stockage** (Firefox)
   → **Cookies** → `https://www.carrefour.fr`.
3. Copiez les cookies. Trois formats sont acceptés :
   - en-tête brut : `sessionid=abc; autre=def`
   - objet JSON : `{"sessionid": "abc", "autre": "def"}`
   - tableau JSON exporté par Playwright / EditThisCookie :
     `[{"name":"sessionid","value":"abc","domain":".carrefour.fr","path":"/"}]`

   Astuce Chrome : dans la console, `document.cookie` renvoie directement l'en-tête brut
   (attention, les cookies `HttpOnly` en sont absents — préférez l'onglet Application).

### Fournir ses cookies

Trois moyens, par ordre de priorité de chargement (les derniers écrasent les premiers) :

| Moyen | Quand l'utiliser |
| --- | --- |
| Fichier de session persistant `data/sessions/cookies.json` | rempli automatiquement, rien à faire |
| `CARREFOUR_COOKIE_FILE=/chemin/cookies.json` | export JSON depuis le navigateur |
| `CARREFOUR_COOKIES="a=1; b=2"` | variable d'env / `.env` |
| Outil MCP `carrefour_set_cookies` | à chaud, depuis la conversation |

Le jar est géré par [`tough-cookie`](https://github.com/salesforce/tough-cookie) : les
attributs `Domain`/`Path`/`Expires` sont respectés, les en-têtes `Set-Cookie` des réponses
sont réinjectés automatiquement, et le jar est persisté dans
`data/sessions/cookies.json` (permissions `0600`, ignoré par git).

### Outils de session

| Outil | Rôle |
| --- | --- |
| `carrefour_set_cookies` | enregistrer / mettre à jour la session |
| `carrefour_session_status` | afficher les cookies stockés ; `verify: true` fait un appel réel pour tester la validité |
| `carrefour_clear_session` | effacer la session locale |
| `carrefour_browser_login` | **optionnel**, exposé uniquement si `playwright` est installé |

Si la session manque ou a expiré (HTTP 401/403), les outils renvoient une erreur explicite
rappelant les trois façons de fournir des cookies — jamais un échec silencieux.

### Login navigateur (optionnel)

```sh
npm install playwright && npx playwright install chromium
```

L'outil `carrefour_browser_login` apparaît alors dans la liste : il ouvre un vrai navigateur,
vous laisse vous connecter (ou remplit email/mot de passe), puis importe les cookies dans le
jar. **Ce n'est jamais nécessaire** : tout fonctionne avec `carrefour_set_cookies`.

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
