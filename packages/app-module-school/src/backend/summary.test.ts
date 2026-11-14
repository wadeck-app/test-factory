import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerClassroomRoutes } from './classrooms';
import { createStore } from './store';
import { registerSummaryRoutes } from './summary';
import { registerTeacherRoutes } from './teachers';

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
  const store = createStore(dir);
  registerSummaryRoutes(ctx, store);
  registerTeacherRoutes(ctx, store);
  registerClassroomRoutes(ctx, store);
  return (route: string, body?: unknown) => {
    const reply = new FakeReply();
    routes.get(route)!({ body, params: {} }, reply);
    return reply;
  };
}

describe('summary route', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'school-summary-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('counts four zeros on an empty store', () => {
    expect(setup(dir)('GET /summary').payload).toEqual({ classrooms: 0, studentClasses: 0, teachers: 0, courses: 0 });
  });

  it('raises the counters after a create', () => {
    const call = setup(dir);
    const classroom = call('POST /classrooms', { name: 'A1', capacity: 20 });
    expect(classroom.status).toBe(201);
    expect(call('POST /teachers', { name: 'Ada', subjects: ['Math'] }).status).toBe(201);
    expect(call('GET /summary').payload).toEqual({ classrooms: 1, studentClasses: 0, teachers: 1, courses: 0 });
  });
});
