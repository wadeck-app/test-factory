import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ScheduleEntry, DAYS, SLOTS, findConflict, storeLookups } from './schedule';
import {
  SAMPLE_CLASSROOMS,
  SAMPLE_COURSES,
  SAMPLE_SLOTS,
  SAMPLE_STUDENT_CLASSES,
  SAMPLE_TEACHERS,
  seedIfEmpty,
} from './seed';
import { CorruptStoreError, type Store, createStore } from './store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'school-seed-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('seedIfEmpty', () => {
  it('writes the expected amount of sample data', () => {
    const store = createStore(dir);
    expect(seedIfEmpty(store)).toBe(true);
    expect(store.collection('classrooms').list()).toHaveLength(6);
    expect(store.collection('classes').list()).toHaveLength(4);
    expect(store.collection('teachers').list()).toHaveLength(8);
    expect(store.collection('courses').list()).toHaveLength(12);
    for (const t of store.collection('teachers').list()) {
      expect((t.subjects as string[]).length).toBeGreaterThan(0);
    }
  });

  it('keeps references consistent', () => {
    const store = createStore(dir);
    seedIfEmpty(store);
    for (const c of store.collection('courses').list()) {
      const teacher = store.collection('teachers').get(c.teacherId as string);
      expect(teacher?.subjects).toContain(c.subject);
      expect(store.collection('classes').get(c.studentClassId as string)).toBeDefined();
    }
  });

  it('seeds a schedule using most of the week without any conflict', () => {
    const store = createStore(dir);
    seedIfEmpty(store);
    const entries = store.collection('slots').list() as unknown as ScheduleEntry[];
    expect(entries.length).toBeGreaterThanOrEqual(20);
    expect(new Set(entries.map((e) => e.day))).toEqual(new Set(DAYS));
    expect(new Set(entries.map((e) => e.slot))).toEqual(new Set(SLOTS));
    const lookups = storeLookups(store);
    const placed: ScheduleEntry[] = [];
    for (const { id: _id, ...entry } of entries) {
      expect(findConflict(placed, entry, lookups)).toBeUndefined();
      placed.push({ id: _id, ...entry });
    }
  });

  it('starts again from empty collections after an interrupted seeding', () => {
    const real = createStore(dir);
    const interrupted: Store = {
      ...real,
      collection(name) {
        const collection = real.collection(name);
        if (name !== 'teachers') {
          return collection;
        }
        return {
          ...collection,
          insert() {
            throw new Error('interrupted');
          },
        };
      },
    };
    expect(() => seedIfEmpty(interrupted)).toThrow('interrupted');
    expect(real.isSeeded()).toBe(false);
    expect(real.collection('classes').list()).toHaveLength(4);

    const store = createStore(dir);
    expect(seedIfEmpty(store)).toBe(true);
    expect(store.collection('classrooms').list()).toEqual(SAMPLE_CLASSROOMS);
    expect(store.collection('classes').list()).toEqual(SAMPLE_STUDENT_CLASSES);
    expect(store.collection('teachers').list()).toEqual(SAMPLE_TEACHERS);
    expect(store.collection('courses').list()).toEqual(SAMPLE_COURSES);
    expect(store.collection('slots').list()).toEqual(SAMPLE_SLOTS);
    expect(store.isSeeded()).toBe(true);
    expect(seedIfEmpty(createStore(dir))).toBe(false);
  });

  it('does not wipe existing data without marker nor modify a corrupt file', () => {
    const store = createStore(dir);
    store.collection('teachers').insert({ id: 'mine', name: 'Mine' });
    expect(seedIfEmpty(store)).toBe(false);
    expect(store.collection('teachers').list()).toHaveLength(1);

    const other = mkdtempSync(join(tmpdir(), 'school-seed-'));
    try {
      const s = createStore(other);
      s.beginSeeding();
      writeFileSync(join(other, 'classes.json'), '{oops', 'utf8');
      expect(() => seedIfEmpty(s)).toThrow(CorruptStoreError);
      expect(readFileSync(join(other, 'classes.json'), 'utf8')).toBe('{oops');
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('does not seed twice nor after the user deleted everything', () => {
    const store = createStore(dir);
    seedIfEmpty(store);
    expect(seedIfEmpty(store)).toBe(false);
    expect(store.collection('classrooms').list()).toHaveLength(6);
    for (const name of ['classrooms', 'classes', 'teachers', 'courses', 'slots'] as const) {
      for (const r of store.collection(name).list()) {
        store.collection(name).remove(r.id);
      }
    }
    expect(seedIfEmpty(store)).toBe(false);
    expect(store.collection('classrooms').list()).toHaveLength(0);
  });
});
