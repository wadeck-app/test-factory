import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore, type CollectionName } from './store';

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
