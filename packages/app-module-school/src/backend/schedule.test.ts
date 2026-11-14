import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import register from './index';
import { validateSchedule } from './schedule';

type Handler = (req: { body?: unknown; params: Record<string, string> }, reply: FakeReply) => unknown;

class FakeReply {
  status = 200;
  payload: unknown;
  code(status: number): this {
    this.status = status;
    return this;
  }
  send(payload?: unknown): this {
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

const idOf = (reply: FakeReply) => (reply.payload as { id: string }).id;
const messageOf = (reply: FakeReply) => (reply.payload as { message: string }).message;

describe('validateSchedule', () => {
  const valid = { courseId: 'c', classroomId: 'r', day: 'mon', slot: '08:00-09:00' };

  it('accepts a valid entry', () => {
    expect(validateSchedule(valid)).toEqual({ ok: true, value: valid });
  });

  it.each([
    [{ ...valid, courseId: '' }],
    [{ ...valid, classroomId: undefined }],
    [{ ...valid, day: 'sat' }],
    [{ ...valid, slot: '8:00-9:00' }],
    [{ ...valid, slot: '09:00-08:00' }],
    [{ ...valid, slot: '08:00-08:00' }],
    [{ ...valid, slot: '08:00-25:00' }],
    [undefined],
  ])('rejects %j', (body) => {
    expect(validateSchedule(body).ok).toBe(false);
  });
});

describe('schedule routes', () => {
  let dir: string;
  let call: ReturnType<typeof setup>;
  let room: string;
  let smallRoom: string;
  let room2: string;
  let courseA: string; // teacher 1, class 6A
  let courseB: string; // teacher 1, class 6B
  let courseC: string; // teacher 2, class 6A
  let courseD: string; // teacher 2, class 6B

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'school-schedule-'));
    call = setup(dir);
    const t1 = idOf(call('POST /teachers', { name: 'Ada', subjects: ['Math'] }));
    const t2 = idOf(call('POST /teachers', { name: 'Bob', subjects: ['Math'] }));
    const k1 = idOf(call('POST /student-classes', { name: '6A', level: '6', studentCount: 20 }));
    const k2 = idOf(call('POST /student-classes', { name: '6B', level: '6', studentCount: 20 }));
    room = idOf(call('POST /classrooms', { name: 'R1', capacity: 30 }));
    room2 = idOf(call('POST /classrooms', { name: 'R2', capacity: 30 }));
    smallRoom = idOf(call('POST /classrooms', { name: 'Tiny', capacity: 10 }));
    const course = (teacherId: string, studentClassId: string) =>
      idOf(call('POST /courses', { subject: 'Math', teacherId, studentClassId }));
    courseA = course(t1, k1);
    courseB = course(t1, k2);
    courseC = course(t2, k1);
    courseD = course(t2, k2);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const entry = (courseId: string, classroomId: string, day = 'mon', slot = '08:00-09:00') => ({
    courseId,
    classroomId,
    day,
    slot,
  });

  it('creates, lists, updates and deletes a valid entry', () => {
    expect(call('GET /schedule').payload).toEqual([]);
    const created = call('POST /schedule', entry(courseA, room));
    expect(created.status).toBe(201);
    const id = idOf(created);
    expect(created.payload).toEqual({ id, ...entry(courseA, room) });
    expect(call('GET /schedule').payload).toEqual([created.payload]);

    // an unchanged re-save does not conflict with itself
    expect(call('PUT /schedule/:id', entry(courseA, room), id).status).toBe(200);
    const moved = call('PUT /schedule/:id', entry(courseA, room, 'tue'), id);
    expect(moved.status).toBe(200);
    expect(moved.payload).toEqual({ id, ...entry(courseA, room, 'tue') });

    expect(call('DELETE /schedule/:id', undefined, id).status).toBe(204);
    expect(call('GET /schedule').payload).toEqual([]);
  });

  it('answers 409 on a classroom conflict', () => {
    call('POST /schedule', entry(courseA, room));
    const clash = call('POST /schedule', entry(courseD, room));
    expect(clash.status).toBe(409);
    expect(messageOf(clash)).toContain('classroom conflict');
    expect(call('GET /schedule').payload).toHaveLength(1);
  });

  it('answers 409 on a teacher conflict', () => {
    call('POST /schedule', entry(courseA, room));
    const clash = call('POST /schedule', entry(courseB, room2));
    expect(clash.status).toBe(409);
    expect(messageOf(clash)).toContain('teacher conflict');
  });

  it('answers 409 on a student class conflict', () => {
    call('POST /schedule', entry(courseA, room));
    const clash = call('POST /schedule', entry(courseC, room2));
    expect(clash.status).toBe(409);
    expect(messageOf(clash)).toContain('class conflict');
  });

  it('accepts the same resources on another day or slot', () => {
    call('POST /schedule', entry(courseA, room));
    expect(call('POST /schedule', entry(courseA, room, 'tue')).status).toBe(201);
    expect(call('POST /schedule', entry(courseA, room, 'mon', '09:00-10:00')).status).toBe(201);
    expect(call('POST /schedule', entry(courseD, room2)).status).toBe(201);
  });

  it('answers 409 when the classroom capacity is below the student count', () => {
    const refused = call('POST /schedule', entry(courseA, smallRoom));
    expect(refused.status).toBe(409);
    expect(messageOf(refused)).toContain('capacity');
    expect(call('GET /schedule').payload).toEqual([]);
  });

  it('checks conflicts on PUT too', () => {
    call('POST /schedule', entry(courseA, room));
    const id = idOf(call('POST /schedule', entry(courseD, room2, 'tue')));
    expect(call('PUT /schedule/:id', entry(courseD, room, 'mon'), id).status).toBe(409);
    expect(call('PUT /schedule/:id', entry(courseD, smallRoom, 'tue'), id).status).toBe(409);
    expect(call('PUT /schedule/:id', entry(courseB, room2, 'mon'), id).status).toBe(409);
    expect(call('PUT /schedule/:id', entry(courseC, room2, 'mon'), id).status).toBe(409);
  });

  it('answers 400 on invalid input and unknown references', () => {
    expect(call('POST /schedule', entry(courseA, room, 'sun')).status).toBe(400);
    expect(call('POST /schedule', entry(courseA, room, 'mon', 'noon')).status).toBe(400);
    expect(call('POST /schedule', entry('nope', room)).status).toBe(400);
    expect(call('POST /schedule', entry(courseA, 'nope')).status).toBe(400);
  });

  it('answers 404 for an unknown entry', () => {
    expect(call('PUT /schedule/:id', entry(courseA, room), 'nope').status).toBe(404);
    expect(call('DELETE /schedule/:id', undefined, 'nope').status).toBe(404);
  });
});
