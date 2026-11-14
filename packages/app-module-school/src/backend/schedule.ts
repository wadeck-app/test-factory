import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import type { CollectionStore, Store } from './store';

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
export type Day = (typeof DAYS)[number];

export interface ScheduleEntry {
  id: string;
  courseId: string;
  classroomId: string;
  day: Day;
  slot: string;
}

export type ScheduleInput = Omit<ScheduleEntry, 'id'>;

type Validation = { ok: true; value: ScheduleInput } | { ok: false; message: string };

const SLOT_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

// `courseId` and `classroomId` are non-empty strings, `day` is mon..fri, `slot` is HH:MM-HH:MM with start before end.
export function validateSchedule(body: unknown): Validation {
  const data: { courseId?: unknown; classroomId?: unknown; day?: unknown; slot?: unknown } =
    typeof body === 'object' && body !== null ? body : {};
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

// Returns the message of the first conflict (classroom, teacher, class, then capacity), if any.
// `entries` must not contain the candidate itself when it is being updated.
export function findConflict(entries: ScheduleEntry[], candidate: ScheduleInput, lookups: Lookups): string | undefined {
  const course = lookups.course(candidate.courseId);
  const classroom = lookups.classroom(candidate.classroomId);
  if (!course || !classroom) {
    return undefined;
  }
  const when = `on ${candidate.day} at ${candidate.slot}`;
  const sameTime = entries.filter((e) => e.day === candidate.day && e.slot === candidate.slot);

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

export function registerScheduleRoutes(ctx: ModuleContext, store: Store): void {
  const slots = (): CollectionStore => store.collection('slots');
  const lookups = storeLookups(store);

  // Returns the refusal (status and message) for an input, `selfId` being the entry being updated.
  const refuse = (input: ScheduleInput, selfId?: string): { status: number; message: string } | undefined => {
    if (!lookups.course(input.courseId)) {
      return { status: 400, message: 'course not found' };
    }
    if (!lookups.classroom(input.classroomId)) {
      return { status: 400, message: 'classroom not found' };
    }
    const others = (slots().list() as unknown as ScheduleEntry[]).filter((e) => e.id !== selfId);
    const conflict = findConflict(others, input, lookups);
    return conflict ? { status: 409, message: conflict } : undefined;
  };

  ctx.registerRoute('GET', '/schedule', (_req, reply) => reply.send(slots().list()));

  ctx.registerRoute('POST', '/schedule', (req, reply) => {
    const result = validateSchedule(req.body);
    if (!result.ok) {
      return reply.code(400).send({ message: result.message });
    }
    const refusal = refuse(result.value);
    if (refusal) {
      return reply.code(refusal.status).send({ message: refusal.message });
    }
    return reply.code(201).send(slots().create(result.value));
  });

  ctx.registerRoute('PUT', '/schedule/:id', (req, reply) => {
    const result = validateSchedule(req.body);
    if (!result.ok) {
      return reply.code(400).send({ message: result.message });
    }
    if (!slots().get(req.params.id)) {
      return reply.code(404).send({ message: 'schedule entry not found' });
    }
    const refusal = refuse(result.value, req.params.id);
    if (refusal) {
      return reply.code(refusal.status).send({ message: refusal.message });
    }
    return reply.send(slots().update(req.params.id, result.value));
  });

  ctx.registerRoute('DELETE', '/schedule/:id', (req, reply) => {
    if (!slots().remove(req.params.id)) {
      return reply.code(404).send({ message: 'schedule entry not found' });
    }
    return reply.code(204).send();
  });
}
