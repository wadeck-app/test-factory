import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { registerClassroomRoutes } from './classrooms';
import { registerCourseRoutes } from './courses';
import { createStore } from './store';
import { registerStudentClassRoutes } from './student-classes';
import { registerTeacherRoutes } from './teachers';

export default function register(ctx: ModuleContext): void {
  ctx.registerRoute('GET', '/ping', (_req, reply) => reply.send({ message: 'hello from school' }));
  const store = createStore(ctx.dataDir);
  registerTeacherRoutes(ctx, store);
  registerClassroomRoutes(ctx, store);
  registerStudentClassRoutes(ctx, store);
  registerCourseRoutes(ctx, store);
}
