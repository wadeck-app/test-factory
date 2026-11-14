import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import type { CollectionStore, Store } from './store';

export interface StudentClass {
  id: string;
  name: string;
  level: string;
  studentCount: number;
}

export type StudentClassInput = Omit<StudentClass, 'id'>;

type Validation = { ok: true; value: StudentClassInput } | { ok: false; message: string };

// `name` and `level` are non-empty strings; `studentCount` must be an integer >= 0 (strictly a number).
export function validateStudentClass(body: unknown): Validation {
  const data: { name?: unknown; level?: unknown; studentCount?: unknown } =
    typeof body === 'object' && body !== null ? body : {};
  if (typeof data.name !== 'string' || data.name.trim() === '') {
    return { ok: false, message: 'name is required' };
  }
  if (typeof data.level !== 'string' || data.level.trim() === '') {
    return { ok: false, message: 'level is required' };
  }
  if (typeof data.studentCount !== 'number' || !Number.isInteger(data.studentCount) || data.studentCount < 0) {
    return { ok: false, message: 'studentCount must be an integer >= 0' };
  }
  return { ok: true, value: { name: data.name.trim(), level: data.level.trim(), studentCount: data.studentCount } };
}

export function registerStudentClassRoutes(ctx: ModuleContext, store: Store): void {
  const studentClasses = (): CollectionStore => store.collection('classes');

  ctx.registerRoute('GET', '/student-classes', (_req, reply) => reply.send(studentClasses().list()));

  ctx.registerRoute('POST', '/student-classes', (req, reply) => {
    const result = validateStudentClass(req.body);
    if (!result.ok) {
      return reply.code(400).send({ message: result.message });
    }
    return reply.code(201).send(studentClasses().create(result.value));
  });

  ctx.registerRoute('PUT', '/student-classes/:id', (req, reply) => {
    const result = validateStudentClass(req.body);
    if (!result.ok) {
      return reply.code(400).send({ message: result.message });
    }
    const updated = studentClasses().update(req.params.id, result.value);
    if (!updated) {
      return reply.code(404).send({ message: 'student class not found' });
    }
    return reply.send(updated);
  });

  ctx.registerRoute('DELETE', '/student-classes/:id', (req, reply) => {
    if (!studentClasses().remove(req.params.id)) {
      return reply.code(404).send({ message: 'student class not found' });
    }
    return reply.send({ deleted: req.params.id });
  });
}
