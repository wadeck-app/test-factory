import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { CorruptStoreError } from './store';

// The answer rule of the whole school module:
// - malformed input: 400 { message }
// - unknown record, or reference to a record that does not exist: 404 { message }
// - record in use, or schedule conflict: 409 { message }
// - corrupt JSON file in the store: 500 { message } naming the file and the fix
// - successful DELETE: 200 { deleted: id }
export const BAD_REQUEST = 400;
export const NOT_FOUND = 404;
export const CONFLICT = 409;
export const UNPROCESSABLE = 422;

// Only what the helpers need from a route reply.
interface Sender {
  code(status: number): { send(payload?: unknown): unknown };
  send(payload?: unknown): unknown;
}

export interface Refusal {
  status: number;
  message: string;
}

export const refusal = (status: number, message: string): Refusal => ({ status, message });

export const refuse = (reply: Sender, r: Refusal): unknown => reply.code(r.status).send({ message: r.message });

export const badRequest = (reply: Sender, message: string): unknown => refuse(reply, refusal(BAD_REQUEST, message));

export const notFound = (reply: Sender, message: string): unknown => refuse(reply, refusal(NOT_FOUND, message));

export const refuseConflict = (reply: Sender, message: string): unknown => refuse(reply, refusal(CONFLICT, message));

export const deleted = (reply: Sender, id: string): unknown => reply.send({ deleted: id });

export const SERVER_ERROR = 500;

const isCorrupt = (error: unknown): error is CorruptStoreError => error instanceof CorruptStoreError;

// Routes of this module answer a corrupt store file with 500 { message }; other errors are rethrown unchanged.
export function withCorruptStoreAnswer(ctx: ModuleContext): ModuleContext {
  const wrapped = Object.create(ctx) as ModuleContext;
  wrapped.registerRoute = (method, path, handler) =>
    ctx.registerRoute(method, path, (req, reply) => {
      const answer = (error: unknown): unknown => {
        if (!isCorrupt(error)) {
          throw error;
        }
        return reply.code(SERVER_ERROR).send({ message: error.advice });
      };
      try {
        const result: unknown = handler(req, reply);
        return result instanceof Promise ? result.catch(answer) : result;
      } catch (error) {
        return answer(error);
      }
    });
  return wrapped;
}
