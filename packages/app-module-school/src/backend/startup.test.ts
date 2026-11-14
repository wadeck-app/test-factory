import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import register from './index';
import { SAMPLE_CLASSROOMS, SAMPLE_COURSES, SAMPLE_SLOTS, SAMPLE_STUDENT_CLASSES, SAMPLE_TEACHERS } from './seed';
import { SEEDED_MARKER, SEEDING_MARKER } from './store';

type Handler = (req: { body?: unknown; params: Record<string, string> }, reply: FakeReply) => unknown;

class FakeReply {
  status = 200;
  payload: unknown;
  code(status: number): this {
    this.status = status;
    return this;
  }
  send(payload: unknown): this {
    this.payload = payload;
    return this;
  }
}

const LIST_ROUTES = [
  'GET /ping',
  'GET /teachers',
  'GET /classrooms',
  'GET /student-classes',
  'GET /courses',
  'GET /schedule',
  'GET /summary',
];

// Starts the module through its register function, like the application does.
function start(dir: string) {
  const routes = new Map<string, Handler>();
  const ctx = {
    dataDir: dir,
    registerRoute: (method: string, path: string, handler: Handler) => routes.set(`${method} ${path}`, handler),
  } as unknown as ModuleContext;
  register(ctx);
  return (route: string, params: Record<string, string> = {}, body?: unknown) => {
    const reply = new FakeReply();
    routes.get(route)!({ body, params }, reply);
    return reply;
  };
}

function snapshot(call: ReturnType<typeof start>) {
  return Object.fromEntries(LIST_ROUTES.map((route) => [route, call(route).payload]));
}

function files(dir: string) {
  return Object.fromEntries(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name), 'utf8')]));
}

describe('module startup', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'school-startup-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads the sample data on the first start', () => {
    const call = start(dir);
    expect(call('GET /teachers').payload).toEqual(SAMPLE_TEACHERS);
    expect(call('GET /classrooms').payload).toEqual(SAMPLE_CLASSROOMS);
    expect(call('GET /student-classes').payload).toEqual(SAMPLE_STUDENT_CLASSES);
    expect(call('GET /courses').payload).toEqual(SAMPLE_COURSES);
    expect(call('GET /schedule').payload).toEqual(SAMPLE_SLOTS);
    expect(call('GET /summary').payload).toEqual({
      classrooms: SAMPLE_CLASSROOMS.length,
      studentClasses: SAMPLE_STUDENT_CLASSES.length,
      teachers: SAMPLE_TEACHERS.length,
      courses: SAMPLE_COURSES.length,
    });
    expect(call('GET /ping').payload).toEqual({ message: 'hello from school' });
    expect(existsSync(join(dir, SEEDED_MARKER))).toBe(true);
    expect(existsSync(join(dir, SEEDING_MARKER))).toBe(false);
  });

  it('changes nothing on a second start', () => {
    const before = snapshot(start(dir));
    const filesBefore = files(dir);
    const second = start(dir);
    expect(snapshot(second)).toEqual(before);
    expect(files(dir)).toEqual(filesBefore);
  });

  it('keeps the changes made between two starts', () => {
    const first = start(dir);
    const edited = SAMPLE_TEACHERS[0];
    // sample teachers have courses (the routes refuse to drop their subjects): change a new one and rename t1
    const free = first('POST /teachers', {}, { name: 'Temp Teacher', subjects: ['Math'] });
    expect(free.status).toBe(201);
    const freeId = (free.payload as { id: string }).id;
    expect(first('DELETE /teachers/:id', { id: freeId }).status).toBe(200);
    expect(first('PUT /teachers/:id', { id: edited.id }, { name: 'Renamed', subjects: edited.subjects }).status).toBe(200);
    const before = snapshot(first);
    const filesBefore = files(dir);

    const second = start(dir);
    expect(snapshot(second)).toEqual(before);
    expect(files(dir)).toEqual(filesBefore);
    const teachers = second('GET /teachers').payload as { id: string; name: string }[];
    expect(teachers.find((t) => t.id === edited.id)?.name).toBe('Renamed');
    expect(teachers.some((t) => t.id === freeId)).toBe(false);
    expect(teachers).toHaveLength(SAMPLE_TEACHERS.length);
  });
});
