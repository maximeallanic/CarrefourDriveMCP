import { z, type ZodTypeAny } from 'zod';
import type { JsonSchemaObject, JsonSchemaProperty } from './types.js';

/**
 * Translate one JSON-Schema property into a zod type.
 * The captured definitions only ever use string / number / boolean / array,
 * but `object` and untyped values are handled defensively.
 */
export function propertyToZod(prop: JsonSchemaProperty): ZodTypeAny {
  switch (prop.type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(prop.items ? propertyToZod(prop.items) : z.any());
    case 'object':
      return z.record(z.any());
    default:
      return z.any();
  }
}

/**
 * Build the raw zod shape consumed by `McpServer.tool()` from a tool's
 * JSON-Schema `parameters` block.
 */
export function schemaToZodShape(schema?: JsonSchemaObject): Record<string, ZodTypeAny> {
  const shape: Record<string, ZodTypeAny> = {};
  if (!schema?.properties) return shape;

  const required = new Set(schema.required ?? []);
  for (const [name, prop] of Object.entries(schema.properties)) {
    let zt = propertyToZod(prop);
    if (prop.description) zt = zt.describe(prop.description);
    shape[name] = required.has(name) ? zt : zt.optional();
  }
  return shape;
}
