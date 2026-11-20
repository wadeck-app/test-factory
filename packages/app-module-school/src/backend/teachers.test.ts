import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caller, fakeContext } from './test-helpers';
import { createStore } from './store';
import { registerTeacherRoutes, validateTeacher } from './teachers';

function setup(dir: string, store = createStore(dir)) {
  const { ctx, routes } = fakeContext();
  registerTeacherRoutes(ctx, store);
  return caller(routes);
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

  it.each([[''], ['   '], ['\t']])('answers 400 naming the field for the name %j, on POST and PUT', (name) => {
    const call = setup(dir);
    const { id } = call('POST /teachers', { name: 'Ada', subjects: ['Math'] }).payload as { id: string };
    const created = call('POST /teachers', { name, subjects: ['Math'] });
    expect(created.status).toBe(400);
    expect((created.payload as { message: string }).message).toContain('name');
    const updated = call('PUT /teachers/:id', { name, subjects: ['Math'] }, id);
    expect(updated.status).toBe(400);
    expect((updated.payload as { message: string }).message).toContain('name');
    expect(call('GET /teachers').payload).toEqual([{ id, name: 'Ada', subjects: ['Math'] }]);
  });

  it.each([[''], ['   '], [undefined], [42]])('answers 400 for the name %j on an unknown id, before the 404', (name) => {
    const reply = setup(dir)('PUT /teachers/:id', { name, subjects: ['Math'] }, 'nope');
    expect(reply.status).toBe(400);
    expect((reply.payload as { message: string }).message).toContain('name');
  });

  it('accepts a name of 80 characters, even with surrounding spaces, on POST and PUT', () => {
    const call = setup(dir);
    const name = 'a'.repeat(80);
    const created = call('POST /teachers', { name: ` ${name} `, subjects: ['Math'] });
    expect(created.status).toBe(201);
    expect(created.payload).toMatchObject({ name });
    const { id } = created.payload as { id: string };
    const updated = call('PUT /teachers/:id', { name: 'b'.repeat(80), subjects: ['Math'] }, id);
    expect(updated.status).toBe(200);
    expect(updated.payload).toEqual({ id, name: 'b'.repeat(80), subjects: ['Math'] });
  });

  it('answers 400 naming the field and the limit for 81 characters, on POST and PUT, without changing data', () => {
    const call = setup(dir);
    const { id } = call('POST /teachers', { name: 'Ada', subjects: ['Math'] }).payload as { id: string };
    const long = 'a'.repeat(81);
    const created = call('POST /teachers', { name: long, subjects: ['Math'] });
    expect(created.status).toBe(400);
    expect(created.payload).toMatchObject({ message: 'name must be at most 80 characters' });
    const updated = call('PUT /teachers/:id', { name: long, subjects: ['Math'] }, id);
    expect(updated.status).toBe(400);
    expect(updated.payload).toMatchObject({ message: 'name must be at most 80 characters' });
    expect(call('GET /teachers').payload).toEqual([{ id, name: 'Ada', subjects: ['Math'] }]);
  });

  it('answers 404 for an unknown id', () => {
    const call = setup(dir);
    expect(call('PUT /teachers/:id', { name: 'Bob', subjects: ['Art'] }, 'nope').status).toBe(404);
    expect(call('DELETE /teachers/:id', undefined, 'nope').status).toBe(404);
  });

  describe('editing subjects used by a course', () => {
    function withCourse() {
      const store = createStore(dir);
      const call = setup(dir, store);
      const { id } = call('POST /teachers', { name: 'Ada', subjects: ['Mathematics', 'Physics'] }).payload as {
        id: string;
      };
      const klass = store.collection('classes').create({ name: '6A' });
      const course = store.collection('courses').create({
        subject: 'Mathematics',
        teacherId: id,
        studentClassId: klass.id,
      });
      return { call, id, courseId: course.id };
    }

    it('answers 409 naming the course and leaves the teacher unchanged', () => {
      const { call, id, courseId } = withCourse();
      const reply = call('PUT /teachers/:id', { name: 'Ada', subjects: 'Physics' }, id);
      expect(reply.status).toBe(409);
      const message = (reply.payload as { message: string }).message;
      expect(message).toContain('Mathematics');
      expect(message).toContain('6A');
      expect(message).toContain(courseId);
      expect(call('GET /teachers').payload).toEqual([{ id, name: 'Ada', subjects: ['Mathematics', 'Physics'] }]);
    });

    it('answers 200 when the course subject is kept, or when no course uses the removed subject', () => {
      const { call, id } = withCourse();
      expect(call('PUT /teachers/:id', { name: 'Ada L.', subjects: 'Mathematics, Art' }, id).status).toBe(200);
      expect(call('PUT /teachers/:id', { name: 'Ada L.', subjects: ['Mathematics'] }, id).status).toBe(200);
    });

    it('answers 400 and 404 before 409', () => {
      const { call, id } = withCourse();
      expect(call('PUT /teachers/:id', { name: 'Ada', subjects: [] }, id).status).toBe(400);
      expect(call('PUT /teachers/:id', { name: 'Ada', subjects: ['Art'] }, 'nope').status).toBe(404);
    });
  });

  it('keeps teachers after a restart', () => {
    const created = setup(dir)('POST /teachers', { name: 'Ada', subjects: ['Math'] });
    expect(setup(dir)('GET /teachers').payload).toEqual([created.payload]);
  });
});
