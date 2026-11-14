import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore } from './store';
import { registerTeacherRoutes, validateTeacher } from './teachers';

type Handler = (req: { body?: unknown; params: Record<string, string> }, reply: FakeReply) => unknown;

class FakeReply {
  status = 200;
  payload: unknown;
  code(status: number): this {
    this.status = status;
    return this;
  }
  send(payload: unknown): this {
    this.payload = payload;
    return this;
  }
}

function setup(dir: string) {
  const routes = new Map<string, Handler>();
  const ctx = {
    registerRoute: (method: string, path: string, handler: Handler) => routes.set(`${method} ${path}`, handler),
  } as unknown as ModuleContext;
  registerTeacherRoutes(ctx, createStore(dir));
  return (route: string, body?: unknown, id?: string) => {
    const reply = new FakeReply();
    routes.get(route)!({ body, params: id ? { id } : {} }, reply);
    return reply;
  };
}

describe('validateTeacher', () => {
  it('accepts a list and trims it', () => {
    expect(validateTeacher({ name: ' Ada ', subjects: [' Math ', 'Physics'] })).toEqual({
      ok: true,
      value: { name: 'Ada', subjects: ['Math', 'Physics'] },
    });
  });

  it('splits a comma separated string and drops empty entries', () => {
    expect(validateTeacher({ name: 'Ada', subjects: 'Math, Physics,, ' })).toEqual({
      ok: true,
      value: { name: 'Ada', subjects: ['Math', 'Physics'] },
    });
  });

  it.each([
    [{ subjects: ['Math'] }],
    [{ name: '  ', subjects: ['Math'] }],
    [{ name: 'Ada' }],
    [{ name: 'Ada', subjects: [] }],
    [{ name: 'Ada', subjects: ' , ' }],
    [{ name: 'Ada', subjects: ['Math', ''] }],
    [{ name: 'Ada', subjects: ['Math', 3] }],
    [{ name: 'Ada', subjects: 3 }],
    [undefined],
  ])('rejects %j', (body) => {
    expect(validateTeacher(body).ok).toBe(false);
  });
});

describe('teacher routes', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'school-teachers-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates, lists, updates and deletes', () => {
    const call = setup(dir);
    expect(call('GET /teachers').payload).toEqual([]);

    const created = call('POST /teachers', { name: 'Ada', subjects: ['Math', 'Physics'] });
    expect(created.status).toBe(201);
    const { id } = created.payload as { id: string };
    expect(created.payload).toEqual({ id, name: 'Ada', subjects: ['Math', 'Physics'] });
    expect(call('GET /teachers').payload).toEqual([created.payload]);

    const updated = call('PUT /teachers/:id', { name: 'Ada L.', subjects: 'Art' }, id);
    expect(updated.status).toBe(200);
    expect(updated.payload).toEqual({ id, name: 'Ada L.', subjects: ['Art'] });

    expect(call('DELETE /teachers/:id', undefined, id).status).toBe(200);
    expect(call('GET /teachers').payload).toEqual([]);
  });

  it('answers 400 on invalid input, for POST and PUT, without changing data', () => {
    const call = setup(dir);
    const { id } = call('POST /teachers', { name: 'Ada', subjects: ['Math'] }).payload as { id: string };
    expect(call('POST /teachers', { name: '', subjects: ['Math'] }).status).toBe(400);
    expect(call('POST /teachers', { name: 'Bob', subjects: [] }).status).toBe(400);
    expect(call('PUT /teachers/:id', { name: 'Bob', subjects: [] }, id).status).toBe(400);
    expect(call('PUT /teachers/:id', { subjects: ['Art'] }, id).status).toBe(400);
    expect(call('GET /teachers').payload).toEqual([{ id, name: 'Ada', subjects: ['Math'] }]);
  });

  it('answers 404 for an unknown id', () => {
    const call = setup(dir);
    expect(call('PUT /teachers/:id', { name: 'Bob', subjects: ['Art'] }, 'nope').status).toBe(404);
    expect(call('DELETE /teachers/:id', undefined, 'nope').status).toBe(404);
  });

  it('keeps teachers after a restart', () => {
    const created = setup(dir)('POST /teachers', { name: 'Ada', subjects: ['Math'] });
    expect(setup(dir)('GET /teachers').payload).toEqual([created.payload]);
  });
});
