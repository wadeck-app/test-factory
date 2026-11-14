import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { findCourseWithRemovedSubject, isTeacherUsed } from './courses';
import { badRequest, notFound, refuseConflict, deleted } from './http';
import type { CollectionStore, Store } from './store';

export interface Teacher {
  id: string;
  name: string;
  subjects: string[];
}

export type TeacherInput = Omit<Teacher, 'id'>;

type Validation = { ok: true; value: TeacherInput } | { ok: false; message: string };

// `subjects` is a list of strings; a comma separated string (as sent by the form) is split into one.
export function validateTeacher(body: unknown): Validation {
  const data: { name?: unknown; subjects?: unknown } = typeof body === 'object' && body !== null ? body : {};
  if (typeof data.name !== 'string' || data.name.trim() === '') {
    return { ok: false, message: 'name is required' };
  }
  const raw = typeof data.subjects === 'string' ? data.subjects.split(',') : data.subjects;
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'subjects must be a non-empty list of strings' };
  }
  if (raw.some((s) => typeof s !== 'string')) {
    return { ok: false, message: 'subjects must be a non-empty list of strings' };
  }
  const subjects = (raw as string[]).map((s) => s.trim()).filter((s) => s !== '');
  if (subjects.length === 0) {
    return { ok: false, message: 'subjects must be a non-empty list of strings' };
  }
  if (Array.isArray(data.subjects) && subjects.length !== raw.length) {
    return { ok: false, message: 'subjects must be a non-empty list of strings' };
  }
  return { ok: true, value: { name: data.name.trim(), subjects } };
}

export function registerTeacherRoutes(ctx: ModuleContext, store: Store): void {
  const teachers = (): CollectionStore => store.collection('teachers');

  ctx.registerRoute('GET', '/teachers', (_req, reply) => reply.send(teachers().list()));

  ctx.registerRoute('POST', '/teachers', (req, reply) => {
    const result = validateTeacher(req.body);
    if (!result.ok) {
      return badRequest(reply, result.message);
    }
    return reply.code(201).send(teachers().create(result.value));
  });

  ctx.registerRoute('PUT', '/teachers/:id', (req, reply) => {
    const result = validateTeacher(req.body);
    if (!result.ok) {
      return badRequest(reply, result.message);
    }
    if (!teachers().get(req.params.id)) {
      return notFound(reply, 'teacher not found');
    }
    const conflict = findCourseWithRemovedSubject(store, req.params.id, result.value.subjects);
    if (conflict) {
      return refuseConflict(reply, conflict);
    }
    return reply.send(teachers().update(req.params.id, result.value));
  });

  ctx.registerRoute('DELETE', '/teachers/:id', (req, reply) => {
    if (teachers().get(req.params.id) && isTeacherUsed(store, req.params.id)) {
      return refuseConflict(reply, 'teacher is used by a course');
    }
    if (!teachers().remove(req.params.id)) {
      return notFound(reply, 'teacher not found');
    }
    return deleted(reply, req.params.id);
  });
}
