import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadToolSpecs, validateSpec } from '../spec/loader.js';
import { schemaToZodShape } from '../spec/params.js';

test('every tool definition in tools/ loads without failure', () => {
  const { specs, failures, dir } = loadToolSpecs();
  assert.deepEqual(failures, [], `failures in ${dir}: ${JSON.stringify(failures)}`);
  assert.equal(specs.length, 43, `expected 43 tools, got ${specs.length}`);
});

test('tool names are unique and MCP-safe', () => {
  const { specs } = loadToolSpecs();
  const names = specs.map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /^[a-zA-Z0-9_-]{1,64}$/);
});

test('validateSpec rejects malformed definitions', () => {
  assert.match(validateSpec({}) ?? '', /missing "name"/);
  assert.match(validateSpec({ name: 'a', description: 'd' }) ?? '', /missing "request"/);
  assert.match(
    validateSpec({ name: 'a', description: 'd', request: { method: 'FOO', url: 'https://x' } }) ?? '',
    /unsupported method/
  );
  assert.match(
    validateSpec({ name: 'a', description: 'd', request: { method: 'GET', url: 'ftp://x' } }) ?? '',
    /invalid url/
  );
  assert.equal(validateSpec({ name: 'a', description: 'd', request: { method: 'GET', url: 'https://x' } }), null);
});

test('schemaToZodShape marks required vs optional parameters', () => {
  const shape = schemaToZodShape({
    type: 'object',
    properties: {
      a: { type: 'string', description: 'A' },
      b: { type: 'number' },
      c: { type: 'array', items: { type: 'string' } },
      d: { type: 'boolean' },
    },
    required: ['a', 'c'],
  });

  assert.equal(shape.a.isOptional(), false);
  assert.equal(shape.b.isOptional(), true);
  assert.equal(shape.c.isOptional(), false);
  assert.equal(shape.d.isOptional(), true);

  assert.deepEqual(shape.c.parse(['x', 'y']), ['x', 'y']);
  assert.throws(() => shape.a.parse(42));
});

test('every tool builds a zod shape covering its declared parameters', () => {
  const { specs } = loadToolSpecs();
  for (const s of specs) {
    const shape = schemaToZodShape(s.parameters);
    const declared = Object.keys(s.parameters?.properties ?? {});
    assert.deepEqual(Object.keys(shape).sort(), declared.sort(), `mismatch for ${s.name}`);
  }
});
