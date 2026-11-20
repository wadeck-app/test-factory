import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupModule as setup } from './test-helpers';
import { validateCourse } from './courses';

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

  it('lists the subjects of a teacher', () => {
    const two = call('POST /teachers', { name: 'Bob', subjects: ['Math', 'Physics'] }).payload as { id: string };
    const ok = call('GET /subject-options/:id', undefined, two.id);
    expect(ok.status).toBe(200);
    expect(ok.payload).toEqual([
      { value: 'Math', label: 'Math' },
      { value: 'Physics', label: 'Physics' },
    ]);
    expect(call('GET /subject-options/:id', undefined, teacherId).payload).toEqual([{ value: 'Math', label: 'Math' }]);
  });

  it('refuses subject options of an unknown teacher or without teacher id', () => {
    expect(call('GET /subject-options/:id', undefined, 'nope').status).toBe(404);
    expect(call('GET /subject-options').status).toBe(400);
  });

  it('answers 400 on invalid input', () => {
    const { id } = call('POST /courses', valid()).payload as { id: string };
    expect(call('POST /courses', { ...valid(), subject: undefined }).status).toBe(400);
    expect(call('PUT /courses/:id', { ...valid(), teacherId: 3 }, id).status).toBe(400);
  });

  it('accepts a subject of 80 characters, trimmed, on creation and update', () => {
    const subject = 'x'.repeat(80);
    const long = (call('POST /teachers', { name: 'Eve', subjects: ['Math', subject] }).payload as { id: string }).id;
    const created = call('POST /courses', { subject: ` ${subject} `, teacherId: long, studentClassId: classId });
    expect(created.status).toBe(201);
    expect(created.payload).toMatchObject({ subject });
    const { id } = call('POST /courses', valid()).payload as { id: string };
    const put = call('PUT /courses/:id', { subject, teacherId: long, studentClassId: classId }, id);
    expect(put.status).toBe(200);
    expect(put.payload).toMatchObject({ subject });
  });

  it('refuses a subject of 81 characters naming the field and the limit, without changing data', () => {
    const subject = 'x'.repeat(81);
    const long = (call('POST /teachers', { name: 'Eve', subjects: ['Math', subject] }).payload as { id: string }).id;
    const { id } = call('POST /courses', valid()).payload as { id: string };
    const before = call('GET /courses').payload;
    const body = { subject, teacherId: long, studentClassId: classId };

    const post = call('POST /courses', body);
    expect(post.status).toBe(400);
    expect(post.payload).toEqual({ message: 'subject must be at most 80 characters' });

    const put = call('PUT /courses/:id', body, id);
    expect(put.status).toBe(400);
    expect(put.payload).toEqual({ message: 'subject must be at most 80 characters' });

    expect(call('PUT /courses/:id', body, 'nope').status).toBe(400);
    expect(call('GET /courses').payload).toEqual(before);
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

  it('answers 409 when the new teacher or class of a course clashes with the schedule, and leaves it unchanged', () => {
    const room1 = (call('POST /classrooms', { name: 'R1', capacity: 30 }).payload as { id: string }).id;
    const room2 = (call('POST /classrooms', { name: 'R2', capacity: 30 }).payload as { id: string }).id;
    const bob = (call('POST /teachers', { name: 'Bob', subjects: ['Math'] }).payload as { id: string }).id;
    const classB = (call('POST /student-classes', { name: '6B', level: '6', studentCount: 20 }).payload as { id: string }).id;
    const a = (call('POST /courses', valid()).payload as { id: string }).id;
    const b = (call('POST /courses', { subject: 'Math', teacherId: bob, studentClassId: classB }).payload as { id: string }).id;
    const slot = { day: 'mon', slot: '08:00-09:00' };
    expect(call('POST /schedule', { courseId: a, classroomId: room1, ...slot }).status).toBe(201);
    expect(call('POST /schedule', { courseId: b, classroomId: room2, ...slot }).status).toBe(201);

    const teacherClash = call('PUT /courses/:id', { ...valid(), teacherId: bob }, a);
    expect(teacherClash.status).toBe(409);
    expect((teacherClash.payload as { message: string }).message).toContain('teacher conflict');
    const classClash = call('PUT /courses/:id', { ...valid(), studentClassId: classB }, a);
    expect(classClash.status).toBe(409);
    expect((classClash.payload as { message: string }).message).toContain('class conflict');
    expect((call('GET /courses').payload as unknown[])).toContainEqual({ id: a, ...valid() });

    // capacity: a course moved to a class too big for its classroom
    const big = (call('POST /student-classes', { name: '6C', level: '6', studentCount: 40 }).payload as { id: string }).id;
    const capacity = call('PUT /courses/:id', { ...valid(), studentClassId: big }, a);
    expect(capacity.status).toBe(409);
    expect((capacity.payload as { message: string }).message).toContain('capacity conflict');

    // a change that does not clash, and an unchanged re-save, succeed
    expect(call('PUT /courses/:id', valid(), a).status).toBe(200);
  });
});
