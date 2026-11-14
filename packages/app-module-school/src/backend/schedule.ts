import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { CONFLICT, NOT_FOUND, type Refusal, refuse } from './http';
import { type Validation, badRequest, bodyAsObject, notFound, deleted, registerOptions } from './http';
import { listClassrooms, listCourses } from './records';
import type { CollectionStore, Store } from './store';

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
export type Day = (typeof DAYS)[number];

export const SLOTS = ['08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00'];

const DAY_LABELS: Record<Day, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri' };
export const DAY_OPTIONS = DAYS.map((d) => ({ value: d, label: DAY_LABELS[d] }));
export const SLOT_OPTIONS = SLOTS.map((s) => ({ value: s, label: s }));

export interface ScheduleEntry {
  id: string;
  courseId: string;
  classroomId: string;
  day: Day;
  slot: string;
}

export type ScheduleInput = Omit<ScheduleEntry, 'id'>;

const SLOT_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

// `courseId` and `classroomId` are non-empty strings, `day` is mon..fri, `slot` is HH:MM-HH:MM with start before end.
export function validateSchedule(body: unknown): Validation<ScheduleInput> {
  const data = bodyAsObject(body);
  for (const field of ['courseId', 'classroomId'] as const) {
    const value = data[field];
    if (typeof value !== 'string' || value.trim() === '') {
      return { ok: false, message: `${field} is required` };
    }
  }
  if (typeof data.day !== 'string' || !(DAYS as readonly string[]).includes(data.day)) {
    return { ok: false, message: `day must be one of ${DAYS.join(', ')}` };
  }
  const slot = typeof data.slot === 'string' ? data.slot.trim() : '';
  const match = SLOT_PATTERN.exec(slot);
  if (!match || `${match[1]}${match[2]}` >= `${match[3]}${match[4]}`) {
    return { ok: false, message: 'slot must be HH:MM-HH:MM with the start before the end' };
  }
  return {
    ok: true,
    value: {
      courseId: (data.courseId as string).trim(),
      classroomId: (data.classroomId as string).trim(),
      day: data.day as Day,
      slot,
    },
  };
}

export interface CourseRef {
  id: string;
  teacherId: string;
  studentClassId: string;
}
export interface ClassroomRef {
  id: string;
  name: string;
  capacity: number;
}
export interface StudentClassRef {
  id: string;
  name: string;
  studentCount: number;
}

export interface Lookups {
  course(id: string): CourseRef | undefined;
  classroom(id: string): ClassroomRef | undefined;
  studentClass(id: string): StudentClassRef | undefined;
}

// Two HH:MM-HH:MM ranges overlap when each starts before the other ends (touching ends do not overlap).
// Zero-padded HH:MM strings compare correctly as text; a malformed stored slot only overlaps an identical one.
export function slotsOverlap(a: string, b: string): boolean {
  const ma = SLOT_PATTERN.exec(a);
  const mb = SLOT_PATTERN.exec(b);
  if (!ma || !mb) {
    return a === b;
  }
  const range = (m: RegExpExecArray) => ({ start: `${m[1]}${m[2]}`, end: `${m[3]}${m[4]}` });
  const ra = range(ma);
  const rb = range(mb);
  return ra.start < rb.end && rb.start < ra.end;
}

// Returns the message of the first conflict (classroom, teacher, class, then capacity), if any.
// `entries` must not contain the candidate itself when it is being updated.
export function findConflict(entries: ScheduleEntry[], candidate: ScheduleInput, lookups: Lookups): string | undefined {
  const course = lookups.course(candidate.courseId);
  const classroom = lookups.classroom(candidate.classroomId);
  if (!course || !classroom) {
    return undefined;
  }
  const when = `on ${candidate.day} at ${candidate.slot}`;
  const sameTime = entries.filter((e) => e.day === candidate.day && slotsOverlap(e.slot, candidate.slot));

  const roomClash = sameTime.find((e) => e.classroomId === candidate.classroomId);
  if (roomClash) {
    return `classroom conflict: ${classroom.name} is already booked ${when} (entry ${roomClash.id})`;
  }
  const teacherClash = sameTime.find((e) => lookups.course(e.courseId)?.teacherId === course.teacherId);
  if (teacherClash) {
    return `teacher conflict: the teacher already has a course ${when} (entry ${teacherClash.id})`;
  }
  const classClash = sameTime.find((e) => lookups.course(e.courseId)?.studentClassId === course.studentClassId);
  if (classClash) {
    return `class conflict: the student class already has a course ${when} (entry ${classClash.id})`;
  }
  const studentClass = lookups.studentClass(course.studentClassId);
  if (studentClass && classroom.capacity < studentClass.studentCount) {
    return `capacity conflict: classroom ${classroom.name} has capacity ${classroom.capacity}, below the ${studentClass.studentCount} students of class ${studentClass.name}`;
  }
  return undefined;
}

export function storeLookups(store: Store): Lookups {
  return {
    course: (id) => store.collection('courses').get(id) as unknown as CourseRef | undefined,
    classroom: (id) => store.collection('classrooms').get(id) as unknown as ClassroomRef | undefined,
    studentClass: (id) => store.collection('classes').get(id) as unknown as StudentClassRef | undefined,
  };
}

type Edit = Partial<{ course: CourseRef; classroom: ClassroomRef; studentClass: StudentClassRef }>;

// Returns the first stored entry (in `slots` order) that `isAffected` selects and that would conflict once `edit`
// (edited versions of stored records) is applied. The message names that entry, then the conflict.
function findBrokenEntry(store: Store, edit: Edit, isAffected: (e: ScheduleEntry, lookups: Lookups) => boolean): string | undefined {
  const base = storeLookups(store);
  const lookups: Lookups = {
    course: (id) => (edit.course?.id === id ? edit.course : base.course(id)),
    classroom: (id) => (edit.classroom?.id === id ? edit.classroom : base.classroom(id)),
    studentClass: (id) => (edit.studentClass?.id === id ? edit.studentClass : base.studentClass(id)),
  };
  const all = store.collection('slots').list() as unknown as ScheduleEntry[];
  for (const entry of all.filter((e) => isAffected(e, base))) {
    const conflict = findConflict(
      all.filter((e) => e.id !== entry.id),
      entry,
      lookups,
    );
    if (conflict) {
      return `schedule entry ${entry.id} (${entry.day} ${entry.slot}) would break: ${conflict}`;
    }
  }
  return undefined;
}

// Returns the first conflict that `course` (an edited version of a stored course) would cause to its own schedule entries.
export const findCourseConflict = (store: Store, course: CourseRef): string | undefined =>
  findBrokenEntry(store, { course }, (e) => e.courseId === course.id);

// Same for an edited classroom (its capacity) and an edited student class (its student count).
export const findClassroomConflict = (store: Store, classroom: ClassroomRef): string | undefined =>
  findBrokenEntry(store, { classroom }, (e) => e.classroomId === classroom.id);

export const findStudentClassConflict = (store: Store, studentClass: StudentClassRef): string | undefined =>
  findBrokenEntry(
    store,
    { studentClass },
    (e, lookups) => lookups.course(e.courseId)?.studentClassId === studentClass.id,
  );

const entriesWhere = (store: Store, key: 'courseId' | 'classroomId', id: string): number =>
  (store.collection('slots').list() as unknown as ScheduleEntry[]).filter((e) => e[key] === id).length;

export const countScheduleEntriesForClassroom = (store: Store, id: string): number => entriesWhere(store, 'classroomId', id);

export const countScheduleEntriesForCourse = (store: Store, id: string): number => entriesWhere(store, 'courseId', id);

// "classroom is used by 2 schedule entries"
export function usedByEntriesMessage(what: string, count: number): string {
  return `${what} is used by ${count} schedule ${count === 1 ? 'entry' : 'entries'}`;
}

export function registerScheduleRoutes(ctx: ModuleContext, store: Store): void {
  const slots = (): CollectionStore => store.collection('slots');
  const lookups = storeLookups(store);

  // Returns the refusal (status and message) for an input, `selfId` being the entry being updated.
  const checkEntry = (input: ScheduleInput, selfId?: string): Refusal | undefined => {
    if (!lookups.course(input.courseId)) {
      return { status: NOT_FOUND, message: "course not found" };
    }
    if (!lookups.classroom(input.classroomId)) {
      return { status: NOT_FOUND, message: 'classroom not found' };
    }
    const others = (slots().list() as unknown as ScheduleEntry[]).filter((e) => e.id !== selfId);
    const conflict = findConflict(others, input, lookups);
    return conflict ? { status: CONFLICT, message: conflict } : undefined;
  };

  ctx.registerRoute('GET', '/schedule', (_req, reply) => reply.send(slots().list()));

  // Description of an entry: subject, teacher, class and classroom.
  const describe = (e: ScheduleEntry) => {
    const course = store.collection('courses').get(e.courseId) as unknown as
      | (CourseRef & { subject: string })
      | undefined;
    const teacher = course && (store.collection('teachers').get(course.teacherId) as unknown as { name: string } | undefined);
    const klass = course && lookups.studentClass(course.studentClassId);
    return {
      subject: course?.subject ?? '?',
      teacher: teacher?.name ?? '?',
      studentClass: klass?.name ?? '?',
      classroom: lookups.classroom(e.classroomId)?.name ?? '?',
    };
  };
  const summary = (e: ScheduleEntry): string => {
    const d = describe(e);
    return `${d.subject} / ${d.teacher} / ${d.studentClass} / ${d.classroom}`;
  };

  // The week as a table: one row per slot (the fixed ones, then any other stored slot), one key per day.
  ctx.registerRoute('GET', '/schedule-grid', (_req, reply) => {
    const entries = slots().list() as unknown as ScheduleEntry[];
    const labels = [...new Set([...SLOTS, ...entries.map((e) => e.slot)])].sort();
    return reply.send(
      labels.map((slot) => {
        const row: Record<string, string> = { slot };
        for (const day of DAYS) {
          row[day] = entries
            .filter((e) => e.day === day && e.slot === slot)
            .map(summary)
            .join('; ');
        }
        return row;
      }),
    );
  });

  // Flat list of entries, with a label, to delete them.
  ctx.registerRoute('GET', '/schedule-entries', (_req, reply) =>
    reply.send(
      (slots().list() as unknown as ScheduleEntry[]).map((e) => ({
        ...e,
        label: `${DAY_LABELS[e.day]} ${e.slot} - ${summary(e)}`,
      })),
    ),
  );

  // `{ value, label }` lists for the selects of the form.
  registerOptions(ctx, '/course-options', () =>
    listCourses(store).map((c) => ({
      value: c.id,
      label: `${c.subject} - ${lookups.studentClass(c.studentClassId)?.name ?? '?'}`,
    })),
  );
  registerOptions(ctx, '/classroom-options', () => listClassrooms(store).map((c) => ({ value: c.id, label: c.name })));
  registerOptions(ctx, '/day-options', () => DAY_OPTIONS);
  registerOptions(ctx, '/slot-options', () => SLOT_OPTIONS);

  ctx.registerRoute('POST', '/schedule', (req, reply) => {
    const result = validateSchedule(req.body);
    if (!result.ok) {
      return badRequest(reply, result.message);
    }
    const refusal = checkEntry(result.value);
    if (refusal) {
      return refuse(reply, refusal);
    }
    return reply.code(201).send(slots().create(result.value));
  });

  ctx.registerRoute('PUT', '/schedule/:id', (req, reply) => {
    const result = validateSchedule(req.body);
    if (!result.ok) {
      return badRequest(reply, result.message);
    }
    if (!slots().get(req.params.id)) {
      return notFound(reply, 'schedule entry not found');
    }
    const refusal = checkEntry(result.value, req.params.id);
    if (refusal) {
      return refuse(reply, refusal);
    }
    return reply.send(slots().update(req.params.id, result.value));
  });

  ctx.registerRoute('DELETE', '/schedule/:id', (req, reply) => {
    if (!slots().remove(req.params.id)) {
      return notFound(reply, 'schedule entry not found');
    }
    return deleted(reply, req.params.id);
  });
}
