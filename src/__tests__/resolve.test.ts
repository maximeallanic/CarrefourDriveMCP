import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, buildQuery, substitute, substituteUrl, MISSING } from '../spec/resolve.js';
import { loadToolSpecs } from '../spec/loader.js';
import type { ToolSpec } from '../spec/types.js';

const { specs } = loadToolSpecs();
const byName = new Map(specs.map((s) => [s.name, s]));

function spec(name: string): ToolSpec {
  const s = byName.get(name);
  assert.ok(s, `tool "${name}" not found in tools/`);
  return s;
}

// --- $param substitution -----------------------------------------------------

test('substitute replaces a plain placeholder', () => {
  assert.equal(substitute({ $param: 'ean' }, { ean: '3560070' }), '3560070');
});

test('substitute keeps non-string types intact', () => {
  assert.equal(substitute({ $param: 'counter' }, { counter: 3 }), 3);
  assert.equal(substitute({ $param: 'flag' }, { flag: false }), false);
  assert.deepEqual(substitute({ $param: 'list' }, { list: ['a', 'b'] }), ['a', 'b']);
});

test('substitute recurses into nested objects and arrays', () => {
  const template = {
    items: [{ ean: { $param: 'ean' }, counter: { $param: 'counter' } }],
    tracking: { pageType: { $param: 'pageType' } },
  };
  assert.deepEqual(substitute(template, { ean: 'X', counter: 2, pageType: 'search' }), {
    items: [{ ean: 'X', counter: 2 }],
    tracking: { pageType: 'search' },
  });
});

test('substitute drops placeholders with no argument', () => {
  assert.equal(substitute({ $param: 'nope' }, {}), MISSING);
  assert.deepEqual(substitute({ a: { $param: 'a' }, b: { $param: 'b' } }, { a: 1 }), { a: 1 });
  assert.deepEqual(substitute([{ $param: 'a' }, { $param: 'b' }], { b: 2 }), [2]);
});

test('an object with extra keys next to $param is not treated as a placeholder', () => {
  assert.deepEqual(substitute({ $param: 'a', other: 1 } as never, { a: 'v' }), { $param: 'a', other: 1 });
});

// --- URL path segments -------------------------------------------------------

test('substituteUrl fills and encodes path segments', () => {
  assert.equal(
    substituteUrl('https://x/api/{a}/{b}', { a: 'drive clcv', b: '1-2/3' }),
    'https://x/api/drive%20clcv/1-2%2F3'
  );
});

test('substituteUrl throws when a path segment is missing', () => {
  assert.throws(() => substituteUrl('https://x/api/{a}', {}), /Missing required URL path parameter "a"/);
});

// --- Query strings -----------------------------------------------------------

test('buildQuery expands arrays into repeated keys', () => {
  const q = buildQuery({ 'codes[]': { $param: 'codes' } }, { codes: ['14', '15'] });
  assert.equal(q.toString(), 'codes%5B%5D=14&codes%5B%5D=15');
});

test('buildQuery skips absent optional params', () => {
  const q = buildQuery({ a: { $param: 'a' }, b: { $param: 'b' } }, { a: 'x' });
  assert.equal(q.toString(), 'a=x');
});

// --- Whole-request construction on real tool definitions ---------------------

test('add_item_to_cart: PATCH with a nested JSON body', () => {
  const req = buildRequest(spec('add_item_to_cart'), {
    ean: '3560071492007',
    counter: 2,
    basketServiceId: '0678-150-7052',
    subBasketType: 'drive_clcv',
    pageType: 'search',
    pageId: 'search',
  });

  assert.equal(req.method, 'PATCH');
  assert.equal(req.url, 'https://www.carrefour.fr/api/cart');
  assert.equal(req.headers['content-type'], 'application/json');
  assert.equal(req.headers['x-requested-with'], 'XMLHttpRequest');
  assert.deepEqual(JSON.parse(req.body as string), {
    trackingRequest: { pageType: 'search', pageId: 'search' },
    items: [
      {
        basketServiceId: '0678-150-7052',
        counter: 2,
        ean: '3560071492007',
        subBasketType: 'drive_clcv',
      },
    ],
  });
});

test('add_item_to_cart_by_ean: optional tracking fields vanish when not supplied', () => {
  const req = buildRequest(spec('add_item_to_cart_by_ean'), {
    ean: '123',
    basketServiceId: 'bs',
    subBasketType: 'drive_clcv',
  });
  assert.deepEqual(JSON.parse(req.body as string), {
    ean: '123',
    basketServiceId: 'bs',
    subBasketType: 'drive_clcv',
    trackingRequest: {},
  });
});

test('get_delivery_timeslots: GET with query and no body', () => {
  const req = buildRequest(spec('get_delivery_timeslots'), { facilityServiceId: '0678-150-149' });
  assert.equal(req.method, 'GET');
  assert.equal(req.url, 'https://www.carrefour.fr/api/timeslots?facilityServiceId=0678-150-149');
  assert.equal(req.body, undefined);
  assert.equal(req.headers['content-type'], undefined);
});

test('validate_checkout_slot: URL segment substitution plus JSON body', () => {
  const req = buildRequest(spec('validate_checkout_slot'), {
    basket_service_type: 'driveclcv',
    deviceFingerPrintId: 'fp-123',
  });
  assert.equal(req.method, 'POST');
  assert.equal(req.url, 'https://www.carrefour.fr/api/checkout/driveclcv/validate/slot');
  assert.deepEqual(JSON.parse(req.body as string), { deviceFingerPrintId: 'fp-123' });
});

test('get_loyalty_order_receipt_details: several URL segments', () => {
  const req = buildRequest(spec('get_loyalty_order_receipt_details'), {
    gln: '3020180204545',
    date_key: '20260601',
    receipt_number: '1-211-1907',
  });
  assert.equal(
    req.url,
    'https://www.carrefour.fr/api/user/secured/loyalty/orders/receipt/3020180204545/20260601/1-211-1907'
  );
});

test('get_account_kpis: array parameter becomes repeated query keys', () => {
  const req = buildRequest(spec('get_account_kpis'), { codes: ['14', '15', '16'] });
  assert.equal(
    req.url,
    'https://www.carrefour.fr/api/user/my-account/kpis?codes%5B%5D=14&codes%5B%5D=15&codes%5B%5D=16'
  );
});

test('create_shopping_list: POST whose payload lives entirely in the query string', () => {
  const req = buildRequest(spec('create_shopping_list'), { title: 'Ma liste' });
  assert.equal(req.method, 'POST');
  assert.equal(req.url, 'https://www.carrefour.fr/api/shopping-lists/memo-list?title=Ma+liste');
  assert.equal(req.body, undefined);
  // No payload -> the declared content-type header must not be sent.
  assert.equal(req.headers['content-type'], undefined);
});

test('get_store_information_inserts: multipart body and URL segment', () => {
  const req = buildRequest(spec('get_store_information_inserts'), {
    store_id: '0678',
    insert_ids: ['checkout_top', 'checkout_summary'],
  });
  assert.equal(req.url, 'https://www.carrefour.fr/api/information-insert/stores/0678');
  assert.ok(req.body instanceof FormData);
  assert.deepEqual((req.body as FormData).getAll('insertIds'), ['checkout_top', 'checkout_summary']);
  // fetch must generate the multipart boundary itself.
  assert.equal(req.headers['content-type'], undefined);
});

test('missing required path parameter surfaces a clear error', () => {
  assert.throws(() => buildRequest(spec('get_shopping_list'), {}), /Missing required URL path parameter/);
});
