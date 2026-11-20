import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caller, fakeContext } from './test-helpers';
import { createStore } from './store';
import { registerStudentClassRoutes, validateStudentClass } from './student-classes';

function setup(dir: string) {
  const { ctx, routes } = fakeContext();
  registerStudentClassRoutes(ctx, createStore(dir));
  return caller(routes);
}

describe('validateStudentClass', () => {
  it('accepts and trims a student class, allowing zero students', () => {
    expect(validateStudentClass({ name: ' 6A ', level: ' 6th ', studentCount: 0 })).toEqual({
      ok: true,
      value: { name: '6A', level: '6th', studentCount: 0 },
    });
  });

  it.each([
    [{ level: '6th', studentCount: 1 }],
    [{ name: '  ', level: '6th', studentCount: 1 }],
    [{ name: 6, level: '6th', studentCount: 1 }],
    [{ name: '6A', studentCount: 1 }],
    [{ name: '6A', level: ' ', studentCount: 1 }],
    [{ name: '6A', level: '6th' }],
    [{ name: '6A', level: '6th', studentCount: -1 }],
    [{ name: '6A', level: '6th', studentCount: 1.5 }],
    [{ name: '6A', level: '6th', studentCount: '3' }],
    [undefined],
  ])('rejects %j', (body) => {
    expect(validateStudentClass(body).ok).toBe(false);
  });
});

describe('student class routes', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'school-student-classes-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates, lists, updates and deletes, updating the file', () => {
    const call = setup(dir);
    const file = () => JSON.parse(readFileSync(join(dir, 'classes.json'), 'utf8'));
    expect(call('GET /student-classes').payload).toEqual([]);

    const created = call('POST /student-classes', { name: '6A', level: '6th', studentCount: 24 });
    expect(created.status).toBe(201);
    const { id } = created.payload as { id: string };
    expect(created.payload).toEqual({ id, name: '6A', level: '6th', studentCount: 24 });
    expect(call('GET /student-classes').payload).toEqual([created.payload]);
    expect(file()).toEqual([created.payload]);

    const updated = call('PUT /student-classes/:id', { name: '6B', level: '6th', studentCount: 0 }, id);
    expect(updated.status).toBe(200);
    expect(file()).toEqual([{ id, name: '6B', level: '6th', studentCount: 0 }]);

    expect(call('DELETE /student-classes/:id', undefined, id).status).toBe(200);
    expect(file()).toEqual([]);
  });

  it('answers 400 on invalid input without changing data', () => {
    const call = setup(dir);
    const { id } = call('POST /student-classes', { name: '6A', level: '6th', studentCount: 3 }).payload as {
      id: string;
    };
    expect(call('POST /student-classes', { name: '', level: '6th', studentCount: 3 }).status).toBe(400);
    expect(call('POST /student-classes', { name: 'B', level: '5th', studentCount: -1 }).status).toBe(400);
    expect(call('PUT /student-classes/:id', { name: 'B', level: '5th', studentCount: '3' }, id).status).toBe(400);
    expect(call('GET /student-classes').payload).toEqual([{ id, name: '6A', level: '6th', studentCount: 3 }]);
  });

  it.each([[''], ['   ']])('refuses the name %j on creation and update, naming the field', (name) => {
    const call = setup(dir);
    const { id } = call('POST /student-classes', { name: '6A', level: '6th', studentCount: 3 }).payload as {
      id: string;
    };
    const created = call('POST /student-classes', { name, level: '6th', studentCount: 3 });
    expect(created.status).toBe(400);
    expect((created.payload as { message: string }).message).toContain('name');
    const updated = call('PUT /student-classes/:id', { name, level: '5th', studentCount: 4 }, id);
    expect(updated.status).toBe(400);
    expect((updated.payload as { message: string }).message).toContain('name');
    expect(call('PUT /student-classes/:id', { name, level: '5th', studentCount: 4 }, 'nope').status).toBe(400);
    expect(call('GET /student-classes').payload).toEqual([{ id, name: '6A', level: '6th', studentCount: 3 }]);
  });

  it.each([['\t'], ['\n'], ['   '], [null]])(
    'refuses the blank or missing name %j on creation and update without storing it',
    (name) => {
      const call = setup(dir);
      const { id } = call('POST /student-classes', { name: '6A', level: '6th', studentCount: 3 }).payload as {
        id: string;
      };
      const created = call('POST /student-classes', { name, level: '6th', studentCount: 3 });
      expect(created.status).toBe(400);
      expect((created.payload as { message: string }).message).toContain('name');
      const updated = call('PUT /student-classes/:id', { name, level: '6th', studentCount: 3 }, id);
      expect(updated.status).toBe(400);
      expect((updated.payload as { message: string }).message).toContain('name');
      expect(call('GET /student-classes').payload).toEqual([{ id, name: '6A', level: '6th', studentCount: 3 }]);
    },
  );

  it('accepts a name of 80 characters on creation and update, ignoring padding whitespace', () => {
    const call = setup(dir);
    const name = 'a'.repeat(80);
    const created = call('POST /student-classes', { name: `  ${name}  `, level: '6th', studentCount: 3 });
    expect(created.status).toBe(201);
    const { id } = created.payload as { id: string };
    expect(created.payload).toEqual({ id, name, level: '6th', studentCount: 3 });
    const newName = 'b'.repeat(80);
    expect(call('PUT /student-classes/:id', { name: newName, level: '6th', studentCount: 3 }, id).status).toBe(200);
    expect(call('GET /student-classes').payload).toEqual([{ id, name: newName, level: '6th', studentCount: 3 }]);
  });

  it('refuses a name of 81 characters on creation and update, naming the field and the limit', () => {
    const call = setup(dir);
    const { id } = call('POST /student-classes', { name: '6A', level: '6th', studentCount: 3 }).payload as {
      id: string;
    };
    const name = 'a'.repeat(81);
    const created = call('POST /student-classes', { name, level: '6th', studentCount: 3 });
    expect(created.status).toBe(400);
    expect(created.payload).toEqual({ message: 'name must be at most 80 characters' });
    const updated = call('PUT /student-classes/:id', { name, level: '6th', studentCount: 3 }, id);
    expect(updated.status).toBe(400);
    expect((updated.payload as { message: string }).message).toBe('name must be at most 80 characters');
    expect(call('PUT /student-classes/:id', { name, level: '6th', studentCount: 3 }, 'nope').status).toBe(400);
    expect(call('GET /student-classes').payload).toEqual([{ id, name: '6A', level: '6th', studentCount: 3 }]);
  });

  it('refuses a duplicate name on creation, ignoring case, naming the field', () => {
    const call = setup(dir);
    const { id } = call('POST /student-classes', { name: '6A', level: '6th', studentCount: 3 }).payload as {
      id: string;
    };
    for (const name of ['6A', '6a', ' 6a ']) {
      const res = call('POST /student-classes', { name, level: '5th', studentCount: 1 });
      expect(res.status).toBe(409);
      expect((res.payload as { message: string }).message).toContain('name');
    }
    expect(call('GET /student-classes').payload).toEqual([{ id, name: '6A', level: '6th', studentCount: 3 }]);
    expect(call('POST /student-classes', { name: '6B', level: '6th', studentCount: 1 }).status).toBe(201);
  });

  it('refuses renaming to another class name, ignoring case, but allows own name and case change', () => {
    const call = setup(dir);
    const { id } = call('POST /student-classes', { name: '6A', level: '6th', studentCount: 3 }).payload as {
      id: string;
    };
    call('POST /student-classes', { name: '6B', level: '6th', studentCount: 3 });
    for (const name of ['6B', '6b']) {
      const res = call('PUT /student-classes/:id', { name, level: '6th', studentCount: 3 }, id);
      expect(res.status).toBe(409);
      expect((res.payload as { message: string }).message).toContain('name');
    }
    expect(call('PUT /student-classes/:id', { name: '6A', level: '5th', studentCount: 4 }, id).status).toBe(200);
    expect(call('PUT /student-classes/:id', { name: '6a', level: '5th', studentCount: 4 }, id).status).toBe(200);
    expect((call('GET /student-classes').payload as { name: string }[])[0].name).toBe('6a');
  });

  it('frees the name of a deleted class', () => {
    const call = setup(dir);
    const { id } = call('POST /student-classes', { name: '6A', level: '6th', studentCount: 3 }).payload as {
      id: string;
    };
    call('DELETE /student-classes/:id', undefined, id);
    expect(call('POST /student-classes', { name: '6a', level: '6th', studentCount: 3 }).status).toBe(201);
  });

  it('answers 404 for an unknown id', () => {
    const call = setup(dir);
    expect(call('PUT /student-classes/:id', { name: 'B', level: '5th', studentCount: 5 }, 'nope').status).toBe(404);
    expect(call('DELETE /student-classes/:id', undefined, 'nope').status).toBe(404);
  });

  it('keeps student classes after a restart', () => {
    const created = setup(dir)('POST /student-classes', { name: '6A', level: '6th', studentCount: 3 });
    expect(setup(dir)('GET /student-classes').payload).toEqual([created.payload]);
  });
});
