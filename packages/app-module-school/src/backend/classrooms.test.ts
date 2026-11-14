import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerClassroomRoutes, validateClassroom } from './classrooms';
import { createStore } from './store';

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
  registerClassroomRoutes(ctx, createStore(dir));
  return (route: string, body?: unknown, id?: string) => {
    const reply = new FakeReply();
    routes.get(route)!({ body, params: id ? { id } : {} }, reply);
    return reply;
  };
}

describe('validateClassroom', () => {
  it('accepts and trims a classroom', () => {
    expect(validateClassroom({ name: ' A1 ', capacity: 30, building: ' Main ' })).toEqual({
      ok: true,
      value: { name: 'A1', capacity: 30, building: 'Main' },
    });
  });

  it('accepts a numeric string capacity and defaults building', () => {
    expect(validateClassroom({ name: 'A1', capacity: '12' })).toEqual({
      ok: true,
      value: { name: 'A1', capacity: 12, building: '' },
    });
  });

  it.each([
    [{ capacity: 10 }],
    [{ name: '  ', capacity: 10 }],
    [{ name: 'A1' }],
    [{ name: 'A1', capacity: 0 }],
    [{ name: 'A1', capacity: -3 }],
    [{ name: 'A1', capacity: 2.5 }],
    [{ name: 'A1', capacity: 'abc' }],
    [{ name: 'A1', capacity: '-3' }],
    [{ name: 'A1', capacity: 10, building: 4 }],
    [undefined],
  ])('rejects %j', (body) => {
    expect(validateClassroom(body).ok).toBe(false);
  });
});

describe('classroom routes', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'school-classrooms-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates, lists, updates and deletes, updating the file', () => {
    const call = setup(dir);
    const file = () => JSON.parse(readFileSync(join(dir, 'classrooms.json'), 'utf8'));
    expect(call('GET /classrooms').payload).toEqual([]);

    const created = call('POST /classrooms', { name: 'A1', capacity: 30, building: 'Main' });
    expect(created.status).toBe(201);
    const { id } = created.payload as { id: string };
    expect(created.payload).toEqual({ id, name: 'A1', capacity: 30, building: 'Main' });
    expect(call('GET /classrooms').payload).toEqual([created.payload]);
    expect(file()).toEqual([created.payload]);

    const updated = call('PUT /classrooms/:id', { name: 'A2', capacity: 25, building: 'East' }, id);
    expect(updated.status).toBe(200);
    expect(file()).toEqual([{ id, name: 'A2', capacity: 25, building: 'East' }]);

    expect(call('DELETE /classrooms/:id', undefined, id).status).toBe(200);
    expect(file()).toEqual([]);
  });

  it('answers 400 on invalid input without changing data', () => {
    const call = setup(dir);
    const { id } = call('POST /classrooms', { name: 'A1', capacity: 30 }).payload as { id: string };
    expect(call('POST /classrooms', { name: '', capacity: 30 }).status).toBe(400);
    expect(call('POST /classrooms', { name: 'B', capacity: 0 }).status).toBe(400);
    expect(call('PUT /classrooms/:id', { name: 'B', capacity: 1.5 }, id).status).toBe(400);
    expect(call('PUT /classrooms/:id', { capacity: 5 }, id).status).toBe(400);
    expect(call('GET /classrooms').payload).toEqual([{ id, name: 'A1', capacity: 30, building: '' }]);
  });

  it('answers 404 for an unknown id', () => {
    const call = setup(dir);
    expect(call('PUT /classrooms/:id', { name: 'B', capacity: 5 }, 'nope').status).toBe(404);
    expect(call('DELETE /classrooms/:id', undefined, 'nope').status).toBe(404);
  });

  it('keeps classrooms after a restart', () => {
    const created = setup(dir)('POST /classrooms', { name: 'A1', capacity: 30 });
    expect(setup(dir)('GET /classrooms').payload).toEqual([created.payload]);
  });
});
