// The answer rule of the whole school module:
// - malformed input: 400 { message }
// - unknown record, or reference to a record that does not exist: 404 { message }
// - record in use, or schedule conflict: 409 { message }
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
