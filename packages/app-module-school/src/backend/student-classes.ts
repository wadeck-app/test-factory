import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { isStudentClassUsed } from './courses';
import { findStudentClassConflict } from './schedule';
import { type Validation, badRequest, bodyAsObject, notFound, refuseConflict, deleted } from './http';
import type { CollectionStore, Store } from './store';
import type { StudentClass, StudentClassInput } from './types';

export type { StudentClass, StudentClassInput };

export const STUDENT_CLASS_NAME_MAX_LENGTH = 80;

// `name` and `level` are non-empty strings (`name` at most 80 characters once trimmed);
// `studentCount` must be an integer >= 0 (strictly a number).
export function validateStudentClass(body: unknown): Validation<StudentClassInput> {
  const data = bodyAsObject(body);
  if (typeof data.name !== 'string' || data.name.trim() === '') {
    return { ok: false, message: 'name is required' };
  }
  if (data.name.trim().length > STUDENT_CLASS_NAME_MAX_LENGTH) {
    return { ok: false, message: `name must be at most ${STUDENT_CLASS_NAME_MAX_LENGTH} characters` };
  }
  if (typeof data.level !== 'string' || data.level.trim() === '') {
    return { ok: false, message: 'level is required' };
  }
  if (typeof data.studentCount !== 'number' || !Number.isInteger(data.studentCount) || data.studentCount < 0) {
    return { ok: false, message: 'studentCount must be an integer >= 0' };
  }
  return { ok: true, value: { name: data.name.trim(), level: data.level.trim(), studentCount: data.studentCount } };
}

const DUPLICATE_NAME_MESSAGE = 'name already used by another class';

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export function registerStudentClassRoutes(ctx: ModuleContext, store: Store): void {
  const studentClasses = (): CollectionStore => store.collection('classes');
  const isNameTaken = (name: string, exceptId?: string): boolean =>
    (studentClasses().list() as unknown as StudentClass[]).some((c) => c.id !== exceptId && sameName(c.name, name));

  ctx.registerRoute('GET', '/student-classes', (_req, reply) => reply.send(studentClasses().list()));

  ctx.registerRoute('POST', '/student-classes', (req, reply) => {
    const result = validateStudentClass(req.body);
    if (!result.ok) {
      return badRequest(reply, result.message);
    }
    if (isNameTaken(result.value.name)) {
      return refuseConflict(reply, DUPLICATE_NAME_MESSAGE);
    }
    return reply.code(201).send(studentClasses().create(result.value));
  });

  ctx.registerRoute('PUT', '/student-classes/:id', (req, reply) => {
    const result = validateStudentClass(req.body);
    if (!result.ok) {
      return badRequest(reply, result.message);
    }
    const current = studentClasses().get(req.params.id) as unknown as StudentClass | undefined;
    if (!current) {
      return notFound(reply, 'student class not found');
    }
    if (isNameTaken(result.value.name, current.id)) {
      return refuseConflict(reply, DUPLICATE_NAME_MESSAGE);
    }
    // only a bigger class can break the schedule
    const conflict =
      result.value.studentCount > current.studentCount
        ? findStudentClassConflict(store, {
            id: current.id,
            name: result.value.name,
            studentCount: result.value.studentCount,
          })
        : undefined;
    if (conflict) {
      return refuseConflict(reply, conflict);
    }
    return reply.send(studentClasses().update(req.params.id, result.value));
  });

  ctx.registerRoute('DELETE', '/student-classes/:id', (req, reply) => {
    if (studentClasses().get(req.params.id) && isStudentClassUsed(store, req.params.id)) {
      return refuseConflict(reply, 'student class is used by a course');
    }
    if (!studentClasses().remove(req.params.id)) {
      return notFound(reply, 'student class not found');
    }
    return deleted(reply, req.params.id);
  });
}
