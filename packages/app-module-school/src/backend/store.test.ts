import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { withCorruptStoreAnswer } from './http';
import { CorruptStoreError, createStore, type CollectionName } from './store';
import { registerTeacherRoutes } from './teachers';

describe('store', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'school-store-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const raw = (name: string) => readFileSync(join(dir, `${name}.json`), 'utf8');

  it('creates a missing file as []', () => {
    const teachers = createStore(join(dir, 'nested')).collection('teachers');
    expect(teachers.list()).toEqual([]);
    expect(readFileSync(join(dir, 'nested', 'teachers.json'), 'utf8')).toBe('[]');
  });

  it('does not overwrite an existing file', () => {
    const store = createStore(dir);
    const id = store.collection('slots').create({ day: 1 }).id;
    expect(createStore(dir).collection('slots').get(id)).toBeDefined();
  });

  it('creates, updates and removes a record, changing the file', () => {
    const courses = createStore(dir).collection('courses');
    expect(existsSync(join(dir, 'courses.json'))).toBe(false);

    const created = courses.create({ name: 'Math' });
    expect(typeof created.id).toBe('string');
    expect(JSON.parse(raw('courses'))).toEqual([{ name: 'Math', id: created.id }]);
    expect(raw('courses')).toContain('\n');
    expect(courses.create({ name: 'Art' }).id).not.toBe(created.id);

    const before = raw('courses');
    const updated = courses.update(created.id, { name: 'Maths', hours: 3 });
    expect(updated).toEqual({ name: 'Maths', hours: 3, id: created.id });
    expect(raw('courses')).not.toBe(before);
    expect(courses.get(created.id)).toEqual(updated);

    expect(courses.remove(created.id)).toBe(true);
    expect(courses.get(created.id)).toBeUndefined();
    expect(JSON.parse(raw('courses'))).toHaveLength(1);
  });

  it('handles unknown ids without changing the file', () => {
    const classes = createStore(dir).collection('classes');
    classes.create({ name: 'A' });
    const before = raw('classes');
    expect(classes.get('nope')).toBeUndefined();
    expect(classes.update('nope', { name: 'B' })).toBeUndefined();
    expect(classes.remove('nope')).toBe(false);
    expect(raw('classes')).toBe(before);
  });

  it('rejects an unknown collection', () => {
    expect(() => createStore(dir).collection('nope' as CollectionName)).toThrow(/Unknown collection/);
  });
});

describe('store with a damaged file', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'school-corrupt-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const broken = '[{"id": "a", "name": ';

  it('refuses to list broken JSON, naming the file, and leaves it untouched', () => {
    writeFileSync(join(dir, 'classrooms.json'), broken, 'utf8');
    const classrooms = createStore(dir).collection('classrooms');
    expect(() => classrooms.list()).toThrow(CorruptStoreError);
    expect(() => classrooms.list()).toThrow(/classrooms\.json is not valid JSON.*fix or restore.*not modified/);
    expect(readFileSync(join(dir, 'classrooms.json'), 'utf8')).toBe(broken);
  });

  it('refuses a create on broken JSON and leaves the file untouched', () => {
    writeFileSync(join(dir, 'classrooms.json'), broken, 'utf8');
    expect(() => createStore(dir).collection('classrooms').create({ name: 'A1' })).toThrow(CorruptStoreError);
    expect(readFileSync(join(dir, 'classrooms.json'), 'utf8')).toBe(broken);
  });

  it.each(['{}', 'null', '"x"'])('treats valid JSON that is not an array (%s) as corrupt', (content) => {
    writeFileSync(join(dir, 'slots.json'), content, 'utf8');
    const slots = createStore(dir).collection('slots');
    expect(() => slots.get('a')).toThrow(CorruptStoreError);
    expect(() => slots.insert({ id: 'a' })).toThrow(CorruptStoreError);
    expect(readFileSync(join(dir, 'slots.json'), 'utf8')).toBe(content);
  });

  it('leaves no temporary file after writes', () => {
    const courses = createStore(dir).collection('courses');
    const { id } = courses.create({ name: 'Math' });
    courses.update(id, { name: 'Art' });
    courses.remove(id);
    expect(readdirSync(dir)).toEqual(['courses.json']);
  });

  it('keeps the original file and removes the temp file when the rename fails', () => {
    // A directory at the target path makes the rename fail.
    mkdirSync(join(dir, 'teachers.json'));
    const teachers = createStore(dir).collection('teachers');
    expect(() => teachers.insert({ id: 'a' })).toThrow();
    expect(readdirSync(dir)).toEqual(['teachers.json']);
  });

  it('answers a route with 500 { message } naming the file', () => {
    writeFileSync(join(dir, 'teachers.json'), broken, 'utf8');
    const routes = new Map<string, (req: unknown, reply: unknown) => unknown>();
    const ctx = {
      registerRoute: (m: string, p: string, h: (req: unknown, reply: unknown) => unknown) => routes.set(`${m} ${p}`, h),
    } as unknown as ModuleContext;
    const store = createStore(dir);
    registerTeacherRoutes(withCorruptStoreAnswer(ctx), store);
    const reply = { status: 200, payload: undefined as { message: string } | undefined, code(s: number) { this.status = s; return this; }, send(p: { message: string }) { this.payload = p; return this; } };
    routes.get('GET /teachers')!({ params: {} }, reply);
    expect(reply.status).toBe(500);
    expect(reply.payload?.message).toMatch(/teachers\.json is not valid JSON/);
    expect(readFileSync(join(dir, 'teachers.json'), 'utf8')).toBe(broken);
  });

  it('rethrows other errors', () => {
    const ctx = { registerRoute: (_m: string, _p: string, h: () => unknown) => h() } as unknown as ModuleContext;
    expect(() =>
      withCorruptStoreAnswer(ctx).registerRoute('GET', '/x', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
  });
});
