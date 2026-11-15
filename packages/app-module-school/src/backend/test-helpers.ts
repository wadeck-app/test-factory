import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import register from './index';
import { SEEDED_MARKER } from './store';

export type Handler = (req: { body?: unknown; params: Record<string, string>; query?: Record<string, string> }, reply: FakeReply) => unknown;

export class FakeReply {
  status = 200;
  payload: unknown;
  code(status: number): this {
    this.status = status;
    return this;
  }
  send(payload?: unknown): this {
    this.payload = payload;
    return this;
  }
}

export const idOf = (reply: FakeReply) => (reply.payload as { id: string }).id;
export const messageOf = (reply: FakeReply) => (reply.payload as { message: string }).message;

// A module context that records the registered routes; `dataDir` is left out when not given.
export function fakeContext(dataDir?: string) {
  const routes = new Map<string, Handler>();
  const ctx = {
    ...(dataDir === undefined ? {} : { dataDir }),
    registerRoute: (method: string, path: string, handler: Handler) => routes.set(`${method} ${path}`, handler),
  } as unknown as ModuleContext;
  return { ctx, routes };
}

// Calls a recorded route with the given params and body.
export function invoke(routes: Map<string, Handler>, route: string, params: Record<string, string> = {}, body?: unknown, query?: Record<string, string>) {
  const reply = new FakeReply();
  routes.get(route)!({ body, params, query }, reply);
  return reply;
}

// Returns `call(route, body?, id?)` over the recorded routes.
export function caller(routes: Map<string, Handler>) {
  return (route: string, body?: unknown, id?: string, query?: Record<string, string>) =>
    invoke(routes, route, id ? { id } : {}, body, query);
}

// Starts the whole module from an empty data directory (seeded marker written, so no sample data).
export function setupModule(dir: string) {
  const { ctx, routes } = fakeContext(dir);
  writeFileSync(join(dir, SEEDED_MARKER), '', 'utf8');
  register(ctx);
  return caller(routes);
}
