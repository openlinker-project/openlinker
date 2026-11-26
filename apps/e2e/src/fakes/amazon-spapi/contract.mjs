/**
 * Contract checks for the fake Amazon server: every request and every response
 * is validated against Amazon's official Swagger models (see fetch-models.mjs).
 * A mismatch is a "contract violation": it is logged, never thrown, so a run
 * finishes and a test can assert there were none.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire('/deps/package.json');

export function loadContracts(dir) {
  if (!existsSync(dir)) return null;
  let Ajv;
  let addFormats;
  try {
    Ajv = require('ajv');
    addFormats = require('ajv-formats');
  } catch {
    return null;
  }
  const specs = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const spec = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
    const ajv = new (Ajv.default ?? Ajv)({ strict: false, allErrors: true, validateFormats: true });
    (addFormats.default ?? addFormats)(ajv);
    ajv.addFormat('int32', true);
    ajv.addFormat('int64', true);
    ajv.addFormat('double', true);
    ajv.addFormat('float', true);
    const ops = [];
    for (const [path, item] of Object.entries(spec.paths ?? {})) {
      const regex = new RegExp(`^${path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+')}$`);
      for (const [method, op] of Object.entries(item)) {
        if (!['get', 'put', 'post', 'patch', 'delete'].includes(method)) continue;
        ops.push({ method: method.toUpperCase(), path, regex, op, params: [...(item.parameters ?? []), ...(op.parameters ?? [])] });
      }
    }
    specs.push({ file, spec, ajv, ops, cache: new Map() });
  }
  return specs;
}

function find(specs, method, pathname) {
  for (const s of specs) for (const o of s.ops) if (o.method === method && o.regex.test(pathname)) return { s, o };
  return null;
}

function compile(s, schema, key) {
  if (!s.cache.has(key)) {
    s.cache.set(key, s.ajv.compile({ ...schema, definitions: s.spec.definitions }));
  }
  return s.cache.get(key);
}

function fmt(errors) {
  return (errors ?? []).slice(0, 6).map((e) => `${e.instancePath || '/'} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`);
}

function paramSchema(p) {
  const { name, in: _in, required, description, collectionFormat, ...rest } = p;
  void name; void _in; void required; void description; void collectionFormat;
  return rest;
}

export function validateRequest(specs, method, pathname, query, bodyText) {
  if (!specs) return [];
  const hit = find(specs, method, pathname);
  if (!hit) return [`no operation in the official models for ${method} ${pathname}`];
  const { s, o } = hit;
  const out = [];
  const declared = new Map(o.params.map((p) => [p.name, p]));
  for (const p of o.params) {
    if (p.in === 'query' && p.required && !(p.name in query)) out.push(`missing required query parameter ${p.name}`);
  }
  for (const [name, value] of Object.entries(query)) {
    const p = declared.get(name);
    if (!p || p.in !== 'query') {
      out.push(`query parameter ${name} is not in the official model`);
      continue;
    }
    const schema = paramSchema(p);
    const instance = p.type === 'array' ? value.split(',') : p.type === 'integer' ? Number(value) : p.type === 'number' ? Number(value) : value;
    const validate = compile(s, schema, `q:${o.method}:${o.path}:${name}`);
    if (!validate(instance)) out.push(`query ${name}=${value.slice(0, 60)}: ${fmt(validate.errors).join('; ')}`);
  }
  const bodyParam = o.params.find((p) => p.in === 'body');
  if (bodyParam) {
    if (bodyParam.required && !bodyText) out.push('missing request body');
    else if (bodyText) {
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        return [...out, 'request body is not JSON'];
      }
      const validate = compile(s, bodyParam.schema, `b:${o.method}:${o.path}`);
      if (!validate(parsed)) out.push(`body: ${fmt(validate.errors).join('; ')}`);
    }
  } else if (bodyText) {
    out.push('request has a body but the official model declares none');
  }
  return out;
}

export function validateResponse(specs, method, pathname, status, body) {
  if (!specs) return [];
  const hit = find(specs, method, pathname);
  if (!hit) return [];
  const { s, o } = hit;
  const resp = o.op.responses?.[String(status)];
  if (!resp) return [`status ${status} is not declared by the official model for ${method} ${o.path}`];
  if (!resp.schema) return [];
  const validate = compile(s, resp.schema, `r:${o.method}:${o.path}:${status}`);
  return validate(body) ? [] : [`response ${status}: ${fmt(validate.errors).join('; ')}`];
}
