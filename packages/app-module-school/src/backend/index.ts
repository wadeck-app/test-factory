import type { ModuleContext } from '@wadeck-app/app-core-sdk';

export default function register(ctx: ModuleContext): void {
  ctx.registerRoute('GET', '/ping', (_req, reply) => reply.send({ message: 'hello from school' }));
}
