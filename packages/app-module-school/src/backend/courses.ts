import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { countScheduleEntriesForCourse, usedByEntriesMessage } from './schedule';
import type { CollectionStore, Store } from './store';

export interface Course {
  id: string;
  subject: string;
  teacherId: string;
  studentClassId: string;
}

export type CourseInput = Omit<Course, 'id'>;

type Validation = { ok: true; value: CourseInput } | { ok: false; message: string };

// `subject`, `teacherId` and `studentClassId` are non-empty strings.
export function validateCourse(body: unknown): Validation {
  const data: { subject?: unknown; teacherId?: unknown; studentClassId?: unknown } =
    typeof body === 'object' && body !== null ? body : {};
  for (const field of ['subject', 'teacherId', 'studentClassId'] as const) {
    const value = data[field];
    if (typeof value !== 'string' || value.trim() === '') {
      return { ok: false, message: `${field} is required` };
    }
  }
  return {
    ok: true,
    value: {
      subject: (data.subject as string).trim(),
      teacherId: (data.teacherId as string).trim(),
      studentClassId: (data.studentClassId as string).trim(),
    },
  };
}

type Teacher = { id: string; name: string; subjects: string[] };
type StudentClass = { id: string; name: string };

// Checks that the referenced teacher and class exist and that the teacher teaches the subject.
function checkReferences(store: Store, input: CourseInput): { status: number; message: string } | undefined {
  const teacher = store.collection('teachers').get(input.teacherId) as unknown as Teacher | undefined;
  if (!teacher) {
    return { status: 404, message: 'teacher not found' };
  }
  if (!store.collection('classes').get(input.studentClassId)) {
    return { status: 404, message: 'student class not found' };
  }
  if (!Array.isArray(teacher.subjects) || !teacher.subjects.includes(input.subject)) {
    return { status: 422, message: `subject "${input.subject}" is not taught by ${teacher.name}` };
  }
  return undefined;
}

export function isTeacherUsed(store: Store, teacherId: string): boolean {
  return store.collection('courses').list().some((c) => c.teacherId === teacherId);
}

export function isStudentClassUsed(store: Store, studentClassId: string): boolean {
  return store.collection('courses').list().some((c) => c.studentClassId === studentClassId);
}

export function registerCourseRoutes(ctx: ModuleContext, store: Store): void {
  const courses = (): CollectionStore => store.collection('courses');

  ctx.registerRoute('GET', '/courses', (_req, reply) => reply.send(courses().list()));

  // Courses with resolved teacher and class names, for the page.
  ctx.registerRoute('GET', '/course-rows', (_req, reply) => {
    const teachers = store.collection('teachers').list() as unknown as Teacher[];
    const classes = store.collection('classes').list() as unknown as StudentClass[];
    return reply.send(
      courses()
        .list()
        .map((c) => ({
          ...c,
          teacherName: teachers.find((t) => t.id === c.teacherId)?.name ?? '?',
          studentClassName: classes.find((k) => k.id === c.studentClassId)?.name ?? '?',
        })),
    );
  });

  // `{ value, label }` lists for the selects of the form.
  ctx.registerRoute('GET', '/teacher-options', (_req, reply) =>
    reply.send((store.collection('teachers').list() as unknown as Teacher[]).map((t) => ({ value: t.id, label: t.name }))),
  );
  ctx.registerRoute('GET', '/student-class-options', (_req, reply) =>
    reply.send(
      (store.collection('classes').list() as unknown as StudentClass[]).map((k) => ({ value: k.id, label: k.name })),
    ),
  );

  ctx.registerRoute('POST', '/courses', (req, reply) => {
    const result = validateCourse(req.body);
    if (!result.ok) {
      return reply.code(400).send({ message: result.message });
    }
    const refusal = checkReferences(store, result.value);
    if (refusal) {
      return reply.code(refusal.status).send({ message: refusal.message });
    }
    return reply.code(201).send(courses().create(result.value));
  });

  ctx.registerRoute('PUT', '/courses/:id', (req, reply) => {
    const result = validateCourse(req.body);
    if (!result.ok) {
      return reply.code(400).send({ message: result.message });
    }
    if (!courses().get(req.params.id)) {
      return reply.code(404).send({ message: 'course not found' });
    }
    const refusal = checkReferences(store, result.value);
    if (refusal) {
      return reply.code(refusal.status).send({ message: refusal.message });
    }
    return reply.send(courses().update(req.params.id, result.value));
  });

  ctx.registerRoute('DELETE', '/courses/:id', (req, reply) => {
    const used = courses().get(req.params.id) ? countScheduleEntriesForCourse(store, req.params.id) : 0;
    if (used > 0) {
      return reply.code(409).send({ message: usedByEntriesMessage('course', used) });
    }
    if (!courses().remove(req.params.id)) {
      return reply.code(404).send({ message: 'course not found' });
    }
    return reply.send({ deleted: req.params.id });
  });
}
