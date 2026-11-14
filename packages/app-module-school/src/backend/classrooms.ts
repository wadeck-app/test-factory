import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { countScheduleEntriesForClassroom, findClassroomConflict, usedByEntriesMessage } from './schedule';
import type { CollectionStore, Store } from './store';

export interface Classroom {
  id: string;
  name: string;
  capacity: number;
  building: string;
}

export type ClassroomInput = Omit<Classroom, 'id'>;

type Validation = { ok: true; value: ClassroomInput } | { ok: false; message: string };

// `capacity` must be a positive integer; a numeric string (as sent by the form) is accepted.
// `building` is optional and defaults to an empty string.
export function validateClassroom(body: unknown): Validation {
  const data: { name?: unknown; capacity?: unknown; building?: unknown } =
    typeof body === 'object' && body !== null ? body : {};
  if (typeof data.name !== 'string' || data.name.trim() === '') {
    return { ok: false, message: 'name is required' };
  }
  const capacity =
    typeof data.capacity === 'string' && /^\s*\d+\s*$/.test(data.capacity) ? Number(data.capacity) : data.capacity;
  if (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity <= 0) {
    return { ok: false, message: 'capacity must be a positive integer' };
  }
  if (data.building !== undefined && data.building !== null && typeof data.building !== 'string') {
    return { ok: false, message: 'building must be a string' };
  }
  return { ok: true, value: { name: data.name.trim(), capacity, building: (data.building ?? '').trim() } };
}

export function registerClassroomRoutes(ctx: ModuleContext, store: Store): void {
  const classrooms = (): CollectionStore => store.collection('classrooms');

  ctx.registerRoute('GET', '/classrooms', (_req, reply) => reply.send(classrooms().list()));

  ctx.registerRoute('POST', '/classrooms', (req, reply) => {
    const result = validateClassroom(req.body);
    if (!result.ok) {
      return reply.code(400).send({ message: result.message });
    }
    return reply.code(201).send(classrooms().create(result.value));
  });

  ctx.registerRoute('PUT', '/classrooms/:id', (req, reply) => {
    const result = validateClassroom(req.body);
    if (!result.ok) {
      return reply.code(400).send({ message: result.message });
    }
    const current = classrooms().get(req.params.id) as unknown as Classroom | undefined;
    if (!current) {
      return reply.code(404).send({ message: 'classroom not found' });
    }
    // only a smaller capacity can break the schedule
    const conflict =
      result.value.capacity < current.capacity
        ? findClassroomConflict(store, { id: current.id, name: result.value.name, capacity: result.value.capacity })
        : undefined;
    if (conflict) {
      return reply.code(409).send({ message: conflict });
    }
    return reply.send(classrooms().update(req.params.id, result.value));
  });

  ctx.registerRoute('DELETE', '/classrooms/:id', (req, reply) => {
    const used = classrooms().get(req.params.id) ? countScheduleEntriesForClassroom(store, req.params.id) : 0;
    if (used > 0) {
      return reply.code(409).send({ message: usedByEntriesMessage('classroom', used) });
    }
    if (!classrooms().remove(req.params.id)) {
      return reply.code(404).send({ message: 'classroom not found' });
    }
    return reply.send({ deleted: req.params.id });
  });
}
