import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import type { Store } from './store';

// Sizes of the lists the classroom, student class, teacher and course routes return.
export function registerSummaryRoutes(ctx: ModuleContext, store: Store): void {
  ctx.registerRoute('GET', '/summary', (_req, reply) =>
    reply.send({
      classrooms: store.collection('classrooms').list().length,
      studentClasses: store.collection('classes').list().length,
      teachers: store.collection('teachers').list().length,
      courses: store.collection('courses').list().length,
    }),
  );
}
