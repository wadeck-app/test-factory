import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { countScheduleEntriesForCourse, findCourseConflict, usedByEntriesMessage } from './schedule';
import {
  NOT_FOUND,
  type Refusal,
  UNPROCESSABLE,
  type Validation,
  badRequest,
  bodyAsObject,
  deleted,
  notFound,
  refuse,
  refuseConflict,
  registerOptions,
} from './http';
import { listCourses, listStudentClasses, listTeachers } from './records';
import type { CollectionStore, Store } from './store';
import type { Course, CourseInput } from './types';

export type { Course, CourseInput };

// `subject`, `teacherId` and `studentClassId` are non-empty strings.
export function validateCourse(body: unknown): Validation<CourseInput> {
  const data = bodyAsObject(body);
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

// Checks that the referenced teacher and class exist and that the teacher teaches the subject.
function checkReferences(store: Store, input: CourseInput): Refusal | undefined {
  const teacher = listTeachers(store).find((t) => t.id === input.teacherId);
  if (!teacher) {
    return { status: NOT_FOUND, message: 'teacher not found' };
  }
  if (!store.collection('classes').get(input.studentClassId)) {
    return { status: NOT_FOUND, message: 'student class not found' };
  }
  if (!Array.isArray(teacher.subjects) || !teacher.subjects.includes(input.subject)) {
    return { status: UNPROCESSABLE, message: `subject "${input.subject}" is not taught by ${teacher.name}` };
  }
  return undefined;
}

export function isTeacherUsed(store: Store, teacherId: string): boolean {
  return store.collection('courses').list().some((c) => c.teacherId === teacherId);
}

// Message naming the courses of the teacher whose subject is not in `subjects`, if any.
export function findCourseWithRemovedSubject(store: Store, teacherId: string, subjects: string[]): string | undefined {
  const classes = listStudentClasses(store);
  const stranded = listCourses(store).filter(
    (c) => c.teacherId === teacherId && !subjects.includes(c.subject),
  );
  if (stranded.length === 0) {
    return undefined;
  }
  const names = stranded.map(
    (c) => `${c.subject} for class ${classes.find((k) => k.id === c.studentClassId)?.name ?? '?'} (course ${c.id})`,
  );
  return `subject still used by course: ${names.join(', ')}`;
}

export function isStudentClassUsed(store: Store, studentClassId: string): boolean {
  return store.collection('courses').list().some((c) => c.studentClassId === studentClassId);
}

export function registerCourseRoutes(ctx: ModuleContext, store: Store): void {
  const courses = (): CollectionStore => store.collection('courses');

  ctx.registerRoute('GET', '/courses', (_req, reply) => reply.send(courses().list()));

  // Courses with resolved teacher and class names, for the page.
  ctx.registerRoute('GET', '/course-rows', (_req, reply) => {
    const teachers = listTeachers(store);
    const classes = listStudentClasses(store);
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
  registerOptions(ctx, '/teacher-options', () => listTeachers(store).map((t) => ({ value: t.id, label: t.name })));
  registerOptions(ctx, '/student-class-options', () =>
    listStudentClasses(store).map((k) => ({ value: k.id, label: k.name })),
  );

  ctx.registerRoute('POST', '/courses', (req, reply) => {
    const result = validateCourse(req.body);
    if (!result.ok) {
      return badRequest(reply, result.message);
    }
    const refusal = checkReferences(store, result.value);
    if (refusal) {
      return refuse(reply, refusal);
    }
    return reply.code(201).send(courses().create(result.value));
  });

  ctx.registerRoute('PUT', '/courses/:id', (req, reply) => {
    const result = validateCourse(req.body);
    if (!result.ok) {
      return badRequest(reply, result.message);
    }
    const current = courses().get(req.params.id);
    if (!current) {
      return notFound(reply, 'course not found');
    }
    const refusal = checkReferences(store, result.value);
    if (refusal) {
      return refuse(reply, refusal);
    }
    // only another teacher or class can break the schedule
    const changed = current.teacherId !== result.value.teacherId || current.studentClassId !== result.value.studentClassId;
    const conflict = changed
      ? findCourseConflict(store, {
          id: req.params.id,
          teacherId: result.value.teacherId,
          studentClassId: result.value.studentClassId,
        })
      : undefined;
    if (conflict) {
      return refuseConflict(reply, conflict);
    }
    return reply.send(courses().update(req.params.id, result.value));
  });

  ctx.registerRoute('DELETE', '/courses/:id', (req, reply) => {
    const used = courses().get(req.params.id) ? countScheduleEntriesForCourse(store, req.params.id) : 0;
    if (used > 0) {
      return refuseConflict(reply, usedByEntriesMessage('course', used));
    }
    if (!courses().remove(req.params.id)) {
      return notFound(reply, 'course not found');
    }
    return deleted(reply, req.params.id);
  });
}
