import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { registerClassroomRoutes } from './classrooms';
import { createStore } from './store';
import { registerTeacherRoutes } from './teachers';

export default function register(ctx: ModuleContext): void {
  ctx.registerRoute('GET', '/ping', (_req, reply) => reply.send({ message: 'hello from school' }));
  const store = createStore(ctx.dataDir);
  registerTeacherRoutes(ctx, store);
  registerClassroomRoutes(ctx, store);
}
