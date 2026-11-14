import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOf, setupModule as setup } from './test-helpers';


// The shared rule: 400 malformed, 404 unknown record or reference, 409 in use or conflict, DELETE 200 { deleted: id }.
describe('shared answer rule', () => {
  let dir: string;
  let call: ReturnType<typeof setup>;
  let teacher: string;
  let studentClass: string;
  let classroom: string;
  let course: string;
  let entry: string;

  const bodies = () => ({
    teachers: { name: 'Grace', subjects: ['Art'] },
    classrooms: { name: 'R9', capacity: 30 },
    'student-classes': { name: '9Z', level: '9', studentCount: 10 },
    courses: { subject: 'Math', teacherId: teacher, studentClassId: studentClass },
    schedule: { courseId: course, classroomId: classroom, day: 'tue', slot: '10:00-11:00' },
  });
  const collections = ['teachers', 'classrooms', 'student-classes', 'courses', 'schedule'] as const;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'school-consistency-'));
    call = setup(dir);
    teacher = idOf(call('POST /teachers', { name: 'Ada', subjects: ['Math'] }));
    studentClass = idOf(call('POST /student-classes', { name: '6A', level: '6', studentCount: 20 }));
    classroom = idOf(call('POST /classrooms', { name: 'R1', capacity: 30 }));
    course = idOf(call('POST /courses', { subject: 'Math', teacherId: teacher, studentClassId: studentClass }));
    entry = idOf(call('POST /schedule', { courseId: course, classroomId: classroom, day: 'mon', slot: '08:00-09:00' }));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.each(collections)('%s: PUT and DELETE of an unknown id answer 404', (name) => {
    expect(call(`PUT /${name}/:id`, bodies()[name], 'nope').status).toBe(404);
    expect(call(`DELETE /${name}/:id`, undefined, 'nope').status).toBe(404);
  });

  it.each(collections)('%s: malformed input answers 400', (name) => {
    expect(call(`POST /${name}`, {}).status).toBe(400);
  });

  it.each(collections)('%s: DELETE of an unused record answers 200 { deleted: id }', (name) => {
    const id = idOf(call(`POST /${name}`, bodies()[name]));
    const reply = call(`DELETE /${name}/:id`, undefined, id);
    expect(reply.status).toBe(200);
    expect(reply.payload).toEqual({ deleted: id });
    expect(call(`DELETE /${name}/:id`, undefined, id).status).toBe(404);
  });

  it('courses and schedule: a missing reference answers 404 on POST and PUT', () => {
    const c = idOf(call('POST /courses', bodies().courses));
    expect(call('POST /courses', { ...bodies().courses, teacherId: 'nope' }).status).toBe(404);
    expect(call('POST /courses', { ...bodies().courses, studentClassId: 'nope' }).status).toBe(404);
    expect(call('PUT /courses/:id', { ...bodies().courses, teacherId: 'nope' }, c).status).toBe(404);
    expect(call('PUT /courses/:id', { ...bodies().courses, studentClassId: 'nope' }, c).status).toBe(404);

    const ok = bodies().schedule;
    const missingCourse = call('POST /schedule', { ...ok, courseId: 'nope' });
    expect(missingCourse.status).toBe(404);
    expect(missingCourse.payload).toEqual({ message: 'course not found' });
    const missingRoom = call('POST /schedule', { ...ok, classroomId: 'nope' });
    expect(missingRoom.status).toBe(404);
    expect(missingRoom.payload).toEqual({ message: 'classroom not found' });
    expect(call('PUT /schedule/:id', { ...ok, courseId: 'nope' }, entry).status).toBe(404);
    expect(call('PUT /schedule/:id', { ...ok, classroomId: 'nope' }, entry).status).toBe(404);
  });

  it('DELETE of a record still in use answers 409 and keeps it', () => {
    expect(call('DELETE /teachers/:id', undefined, teacher).status).toBe(409);
    expect(call('DELETE /student-classes/:id', undefined, studentClass).status).toBe(409);
    expect(call('DELETE /classrooms/:id', undefined, classroom).status).toBe(409);
    expect(call('DELETE /courses/:id', undefined, course).status).toBe(409);
    expect(call('GET /schedule').payload).toHaveLength(1);
    expect(call('DELETE /schedule/:id', undefined, entry).payload).toEqual({ deleted: entry });
    expect(call('DELETE /courses/:id', undefined, course).status).toBe(200);
  });

  it('a schedule conflict answers 409', () => {
    const other = idOf(call('POST /classrooms', { name: 'R2', capacity: 30 }));
    const clash = call('POST /schedule', { courseId: course, classroomId: other, day: 'mon', slot: '08:00-09:00' });
    expect(clash.status).toBe(409);
  });
});
