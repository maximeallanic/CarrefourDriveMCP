/**
 * Types describing the declarative tool definitions stored in `tools/*.json`.
 *
 * These files were extracted from real carrefour.fr traffic. They are fully
 * self-describing: parameter schema + HTTP request template with `{"$param": "x"}`
 * placeholders. This project executes them directly — no external runner needed.
 */

export type ParamRef = { $param: string };

export type Template =
  | ParamRef
  | string
  | number
  | boolean
  | null
  | Template[]
  | { [key: string]: Template };

export interface JsonSchemaProperty {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  items?: JsonSchemaProperty;
  enum?: unknown[];
}

export interface JsonSchemaObject {
  type: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export interface RequestSpec {
  method: HttpMethod;
  url: string;
  headers?: Record<string, Template>;
  query?: Record<string, Template>;
  body?: Template;
  content_type?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters?: JsonSchemaObject;
  request: RequestSpec;
  requires_auth?: boolean;
  example_traces?: string[];
}

/** A fully resolved HTTP request, ready to be handed to `fetch`. */
export interface BuiltRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  /** Already-encoded body, or undefined for bodyless requests. */
  body?: string | FormData;
}
