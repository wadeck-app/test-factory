import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ScheduleEntry, DAYS, SLOTS, findConflict, storeLookups } from './schedule';
import { seedIfEmpty } from './seed';
import { createStore } from './store';

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
