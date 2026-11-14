import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { registerClassroomRoutes } from './classrooms';
import { registerCourseRoutes } from './courses';
import { registerScheduleRoutes } from './schedule';
import { seedIfEmpty } from './seed';
import { createStore } from './store';
import { registerStudentClassRoutes } from './student-classes';
import { registerSummaryRoutes } from './summary';
import { registerTeacherRoutes } from './teachers';

export default function register(ctx: ModuleContext): void {
  ctx.registerRoute('GET', '/ping', (_req, reply) => reply.send({ message: 'hello from school' }));
  const store = createStore(ctx.dataDir);
  seedIfEmpty(store);
  registerTeacherRoutes(ctx, store);
  registerClassroomRoutes(ctx, store);
  registerStudentClassRoutes(ctx, store);
  registerCourseRoutes(ctx, store);
  registerScheduleRoutes(ctx, store);
  registerSummaryRoutes(ctx, store);
}
