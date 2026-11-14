import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeContext, invoke } from './test-helpers';
import { registerClassroomRoutes } from './classrooms';
import { createStore } from './store';
import { registerSummaryRoutes } from './summary';
import { registerTeacherRoutes } from './teachers';

function setup(dir: string) {
  const { ctx, routes } = fakeContext();
  const store = createStore(dir);
  registerSummaryRoutes(ctx, store);
  registerTeacherRoutes(ctx, store);
  registerClassroomRoutes(ctx, store);
  return (route: string, body?: unknown) => invoke(routes, route, {}, body);
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
