import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import register from './index';
import { SEEDED_MARKER } from './store';
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
  writeFileSync(join(dir, SEEDED_MARKER), '', 'utf8'); // these tests start from an empty module
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

  it('answers 409 when time ranges overlap, and accepts ranges that only touch', () => {
    call('POST /schedule', entry(courseA, room, 'mon', '08:00-10:00'));
    const partial = call('POST /schedule', entry(courseD, room, 'mon', '09:00-10:00'));
    expect(partial.status).toBe(409);
    expect(messageOf(partial)).toContain('classroom conflict');
    expect(call('POST /schedule', entry(courseD, room, 'mon', '09:00-11:00')).status).toBe(409);
    expect(call('POST /schedule', entry(courseD, room, 'mon', '07:00-12:00')).status).toBe(409);
    expect(call('GET /schedule').payload).toHaveLength(1);
    expect(call('POST /schedule', entry(courseD, room, 'tue', '09:00-10:00')).status).toBe(201);
    expect(call('POST /schedule', entry(courseD, room, 'mon', '10:00-12:00')).status).toBe(201);
  });

  it('applies the overlap rule to teachers and student classes', () => {
    call('POST /schedule', entry(courseA, room, 'mon', '08:00-10:00'));
    const teacher = call('POST /schedule', entry(courseB, room2, 'mon', '09:00-10:00'));
    expect(teacher.status).toBe(409);
    expect(messageOf(teacher)).toContain('teacher conflict');
    const klass = call('POST /schedule', entry(courseC, room2, 'mon', '09:00-11:00'));
    expect(klass.status).toBe(409);
    expect(messageOf(klass)).toContain('class conflict');
    expect(call('POST /schedule', entry(courseD, room2, 'mon', '09:00-11:00')).status).toBe(201);
  });

  it('checks overlaps on PUT, ignoring the entry itself', () => {
    const id = idOf(call('POST /schedule', entry(courseA, room, 'mon', '08:00-10:00')));
    call('POST /schedule', entry(courseD, room, 'mon', '10:00-12:00'));
    expect(call('PUT /schedule/:id', entry(courseA, room, 'mon', '09:00-11:00'), id).status).toBe(409);
    expect(call('PUT /schedule/:id', entry(courseA, room, 'mon', '08:00-09:00'), id).status).toBe(200);
    const stored = (call('GET /schedule').payload as { id: string; slot: string }[]).find((e) => e.id === id);
    expect(stored?.slot).toBe('08:00-09:00');
  });

  it('answers 400 when the end is not after the start', () => {
    const message = 'slot must be HH:MM-HH:MM with the start before the end';
    const id = idOf(call('POST /schedule', entry(courseA, room)));
    for (const slot of ['10:00-10:00', '10:00-09:00', '9-10']) {
      const created = call('POST /schedule', entry(courseA, room, 'tue', slot));
      expect(created.status).toBe(400);
      expect(messageOf(created)).toBe(message);
      expect(call('PUT /schedule/:id', entry(courseA, room, 'tue', slot), id).status).toBe(400);
    }
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

  it('moves an entry to a free slot and keeps it unchanged on a conflict', () => {
    const id = idOf(call('POST /schedule', entry(courseA, room)));
    call('POST /schedule', entry(courseD, room2, 'tue'));
    const free = call('PUT /schedule/:id', entry(courseA, room, 'mon', '09:00-10:00'), id);
    expect(free.status).toBe(200);
    expect(call('PUT /schedule/:id', entry(courseA, room2, 'tue'), id).status).toBe(409);
    expect(call('PUT /schedule/:id', entry(courseA, room, 'sun'), id).status).toBe(400);
    expect(call('PUT /schedule/:id', entry('nope', room), id).status).toBe(400);
    expect(call('PUT /schedule/:id', entry(courseA, 'nope'), id).status).toBe(400);
    const stored = (call('GET /schedule').payload as { id: string }[]).find((e) => e.id === id);
    expect(stored).toEqual({ id, ...entry(courseA, room, 'mon', '09:00-10:00') });
  });

  it('answers 400 on invalid input and unknown references', () => {
    expect(call('POST /schedule', entry(courseA, room, 'sun')).status).toBe(400);
    expect(call('POST /schedule', entry(courseA, room, 'mon', 'noon')).status).toBe(400);
    expect(call('POST /schedule', entry('nope', room)).status).toBe(400);
    expect(call('POST /schedule', entry(courseA, 'nope')).status).toBe(400);
  });

  it('builds the grid, the entries list and the options', () => {
    const id = idOf(call('POST /schedule', entry(courseA, room, 'tue', '09:00-10:00')));
    call('POST /schedule', entry(courseD, room2, 'tue', '09:00-10:00'));
    call('POST /schedule', entry(courseA, room, 'fri', '14:00-15:00'));
    const grid = call('GET /schedule-grid').payload as Record<string, string>[];
    expect(grid.map((r) => r.slot)).toEqual(['08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00', '14:00-15:00']);
    expect(grid[0]).toEqual({ slot: '08:00-09:00', mon: '', tue: '', wed: '', thu: '', fri: '' });
    expect(grid[1].tue).toBe('Math / Ada / 6A / R1; Math / Bob / 6B / R2');
    expect(grid[4].fri).toBe('Math / Ada / 6A / R1');

    const entries = call('GET /schedule-entries').payload as { id: string; label: string }[];
    expect(entries[0]).toMatchObject({ id, label: 'Tue 09:00-10:00 - Math / Ada / 6A / R1' });

    expect(call('GET /course-options').payload).toContainEqual({ value: courseA, label: 'Math - 6A' });
    expect(call('GET /classroom-options').payload).toContainEqual({ value: room, label: 'R1' });
    expect(call('GET /day-options').payload).toHaveLength(5);
    expect(call('GET /slot-options').payload).toHaveLength(4);
  });

  it('refuses to delete a classroom used by schedule entries, then allows it', () => {
    const a = idOf(call('POST /schedule', entry(courseA, room)));
    const b = idOf(call('POST /schedule', entry(courseB, room, 'tue')));
    const refused = call('DELETE /classrooms/:id', undefined, room);
    expect(refused.status).toBe(409);
    expect(messageOf(refused)).toBe('classroom is used by 2 schedule entries');
    call('DELETE /schedule/:id', undefined, a);
    expect(messageOf(call('DELETE /classrooms/:id', undefined, room))).toBe('classroom is used by 1 schedule entry');
    call('DELETE /schedule/:id', undefined, b);
    const ok = call('DELETE /classrooms/:id', undefined, room);
    expect(ok.status).toBe(200);
    expect(ok.payload).toEqual({ deleted: room });
    expect(call('DELETE /classrooms/:id', undefined, room).status).toBe(404);
    expect(messageOf(call('DELETE /classrooms/:id', undefined, 'nope'))).toBe('classroom not found');
  });

  it('refuses to delete a course used by schedule entries, then allows it', () => {
    const a = idOf(call('POST /schedule', entry(courseA, room)));
    const refused = call('DELETE /courses/:id', undefined, courseA);
    expect(refused.status).toBe(409);
    expect(messageOf(refused)).toBe('course is used by 1 schedule entry');
    expect((call('GET /courses').payload as unknown[]).length).toBe(4);
    call('DELETE /schedule/:id', undefined, a);
    expect(call('DELETE /courses/:id', undefined, courseA).status).toBe(200);
    expect(call('DELETE /courses/:id', undefined, courseA).status).toBe(404);
    expect(call('DELETE /courses/:id', undefined, courseB).status).toBe(200);
  });

  it('answers 404 for an unknown entry', () => {
    expect(call('PUT /schedule/:id', entry(courseA, room), 'nope').status).toBe(404);
    expect(call('DELETE /schedule/:id', undefined, 'nope').status).toBe(404);
  });
});

describe('edits that would break the schedule', () => {
  let dir: string;
  let call: ReturnType<typeof setup>;
  let room: string;
  let class24: string;
  let teacher: string;
  let course: string;
  let entry: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'school-schedule-edit-'));
    call = setup(dir);
    teacher = idOf(call('POST /teachers', { name: 'Ada', subjects: ['Math'] }));
    class24 = idOf(call('POST /student-classes', { name: '6A', level: '6', studentCount: 24 }));
    room = idOf(call('POST /classrooms', { name: 'R1', capacity: 30, building: 'Main' }));
    course = idOf(call('POST /courses', { subject: 'Math', teacherId: teacher, studentClassId: class24 }));
    entry = idOf(call('POST /schedule', { courseId: course, classroomId: room, day: 'mon', slot: '08:00-09:00' }));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a classroom capacity below the scheduled class, then accepts a larger one', () => {
    const refused = call('PUT /classrooms/:id', { name: 'R1', capacity: 20, building: 'Main' }, room);
    expect(refused.status).toBe(409);
    expect(messageOf(refused)).toContain('capacity conflict');
    expect(messageOf(refused)).toContain(`entry ${entry}`);
    expect(messageOf(refused)).toContain('mon 08:00-09:00');
    expect((call('GET /classrooms').payload as { capacity: number }[])[0].capacity).toBe(30);
    expect(call('PUT /classrooms/:id', { name: 'R1', capacity: 24, building: 'Main' }, room).status).toBe(200);
    expect(call('PUT /classrooms/:id', { name: 'R1', capacity: 40, building: 'Main' }, room).status).toBe(200);
  });

  it('keeps 400 and 404 before the classroom conflict, and allows unscheduled or unrelated edits', () => {
    expect(call('PUT /classrooms/:id', { name: 'R1', capacity: 0 }, room).status).toBe(400);
    expect(call('PUT /classrooms/:id', { name: 'R1', capacity: 1 }, 'nope').status).toBe(404);
    const free = idOf(call('POST /classrooms', { name: 'R2', capacity: 30 }));
    expect(call('PUT /classrooms/:id', { name: 'R2', capacity: 5 }, free).status).toBe(200);
    expect(call('PUT /classrooms/:id', { name: 'Renamed', capacity: 30, building: 'B' }, room).status).toBe(200);
  });

  it('refuses a student count above the capacity of a scheduled room, then accepts a lower one', () => {
    const body = (studentCount: number) => ({ name: '6A', level: '6', studentCount });
    const refused = call('PUT /student-classes/:id', body(31), class24);
    expect(refused.status).toBe(409);
    expect(messageOf(refused)).toContain('capacity conflict');
    expect(messageOf(refused)).toContain(`entry ${entry}`);
    expect((call('GET /student-classes').payload as { studentCount: number }[])[0].studentCount).toBe(24);
    expect(call('PUT /student-classes/:id', body(30), class24).status).toBe(200);
    expect(call('PUT /student-classes/:id', body(10), class24).status).toBe(200);
    expect(call('PUT /student-classes/:id', body(10), 'nope').status).toBe(404);
    expect(call('PUT /student-classes/:id', { ...body(10), name: '' }, class24).status).toBe(400);
    const lone = idOf(call('POST /student-classes', { name: '6Z', level: '6', studentCount: 5 }));
    expect(call('PUT /student-classes/:id', body(500), lone).status).toBe(200);
  });

  it('names the broken entry when a course changes to a clashing teacher or class', () => {
    const bob = idOf(call('POST /teachers', { name: 'Bob', subjects: ['Math'] }));
    const class2 = idOf(call('POST /student-classes', { name: '6B', level: '6', studentCount: 10 }));
    const room2 = idOf(call('POST /classrooms', { name: 'R2', capacity: 30 }));
    const other = idOf(call('POST /courses', { subject: 'Math', teacherId: bob, studentClassId: class2 }));
    call('POST /schedule', { courseId: other, classroomId: room2, day: 'mon', slot: '08:00-09:00' });

    const teacherClash = call('PUT /courses/:id', { subject: 'Math', teacherId: bob, studentClassId: class24 }, course);
    expect(teacherClash.status).toBe(409);
    expect(messageOf(teacherClash)).toContain('teacher conflict');
    expect(messageOf(teacherClash)).toContain(`schedule entry ${entry}`);
    const classClash = call('PUT /courses/:id', { subject: 'Math', teacherId: teacher, studentClassId: class2 }, course);
    expect(classClash.status).toBe(409);
    expect(messageOf(classClash)).toContain('class conflict');
    expect(call('PUT /courses/:id', { subject: 'Math', teacherId: teacher, studentClassId: class24 }, course).status).toBe(200);
    expect(call('PUT /courses/:id', { subject: 'Math', teacherId: bob, studentClassId: class24 }, 'nope').status).toBe(404);
  });
});
