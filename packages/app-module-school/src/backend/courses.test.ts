import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import register from './index';
import { validateCourse } from './courses';

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
    dataDir: dir,
    registerRoute: (method: string, path: string, handler: Handler) => routes.set(`${method} ${path}`, handler),
  } as unknown as ModuleContext;
  register(ctx);
  return (route: string, body?: unknown, id?: string) => {
    const reply = new FakeReply();
    routes.get(route)!({ body, params: id ? { id } : {} }, reply);
    return reply;
  };
}

describe('validateCourse', () => {
  it('trims valid input', () => {
    expect(validateCourse({ subject: ' Math ', teacherId: 't', studentClassId: 'c' })).toEqual({
      ok: true,
      value: { subject: 'Math', teacherId: 't', studentClassId: 'c' },
    });
  });

  it.each([
    [{ teacherId: 't', studentClassId: 'c' }],
    [{ subject: 'Math', studentClassId: 'c' }],
    [{ subject: 'Math', teacherId: 't' }],
    [{ subject: 3, teacherId: 't', studentClassId: 'c' }],
    [{ subject: ' ', teacherId: 't', studentClassId: 'c' }],
    [undefined],
  ])('rejects %j', (body) => {
    expect(validateCourse(body).ok).toBe(false);
  });
});

describe('course routes', () => {
  let dir: string;
  let call: ReturnType<typeof setup>;
  let teacherId: string;
  let classId: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'school-courses-'));
    call = setup(dir);
    teacherId = (call('POST /teachers', { name: 'Ada', subjects: ['Math'] }).payload as { id: string }).id;
    classId = (call('POST /student-classes', { name: '6A', level: '6', studentCount: 20 }).payload as { id: string }).id;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const valid = () => ({ subject: 'Math', teacherId, studentClassId: classId });

  it('creates, lists, updates and deletes', () => {
    expect(call('GET /courses').payload).toEqual([]);
    const created = call('POST /courses', valid());
    expect(created.status).toBe(201);
    const { id } = created.payload as { id: string };
    expect(created.payload).toEqual({ id, ...valid() });
    expect(call('GET /courses').payload).toEqual([created.payload]);

    const updated = call('PUT /courses/:id', valid(), id);
    expect(updated.status).toBe(200);
    expect(call('DELETE /courses/:id', undefined, id).status).toBe(200);
    expect(call('GET /courses').payload).toEqual([]);
  });

  it('resolves names for the page and lists select options', () => {
    call('POST /courses', valid());
    expect(call('GET /course-rows').payload).toMatchObject([{ teacherName: 'Ada', studentClassName: '6A' }]);
    expect(call('GET /teacher-options').payload).toEqual([{ value: teacherId, label: 'Ada' }]);
    expect(call('GET /student-class-options').payload).toEqual([{ value: classId, label: '6A' }]);
  });

  it('answers 400 on invalid input', () => {
    const { id } = call('POST /courses', valid()).payload as { id: string };
    expect(call('POST /courses', { ...valid(), subject: undefined }).status).toBe(400);
    expect(call('PUT /courses/:id', { ...valid(), teacherId: 3 }, id).status).toBe(400);
  });

  it('refuses unknown teacher, unknown class and subject not taught', () => {
    expect(call('POST /courses', { ...valid(), teacherId: 'nope' }).status).toBe(404);
    expect(call('POST /courses', { ...valid(), studentClassId: 'nope' }).status).toBe(404);
    const bad = call('POST /courses', { ...valid(), subject: 'Art' });
    expect(bad.status).toBe(422);
    expect(bad.payload).toEqual({ message: 'subject "Art" is not taught by Ada' });
    const { id } = call('POST /courses', valid()).payload as { id: string };
    expect(call('PUT /courses/:id', { ...valid(), subject: 'Art' }, id).status).toBe(422);
    expect(call('GET /courses').payload).toEqual([{ id, ...valid() }]);
  });

  it('answers 404 for an unknown course', () => {
    expect(call('PUT /courses/:id', valid(), 'nope').status).toBe(404);
    expect(call('DELETE /courses/:id', undefined, 'nope').status).toBe(404);
  });

  it('answers 409 when deleting a teacher or class used by a course, then allows it', () => {
    const { id } = call('POST /courses', valid()).payload as { id: string };
    expect(call('DELETE /teachers/:id', undefined, teacherId).status).toBe(409);
    expect(call('DELETE /student-classes/:id', undefined, classId).status).toBe(409);
    call('DELETE /courses/:id', undefined, id);
    expect(call('DELETE /teachers/:id', undefined, teacherId).status).toBe(200);
    expect(call('DELETE /student-classes/:id', undefined, classId).status).toBe(200);
    expect(call('DELETE /teachers/:id', undefined, teacherId).status).toBe(404);
  });
});
