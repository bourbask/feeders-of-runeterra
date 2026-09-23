/**
 * Result — the engine never throws on a rule violation.
 *
 * `decide()` returns `err({ code, details })` for an intent the rules refuse.
 * Exceptions stay reserved for programming errors (a caller handing the engine
 * something structurally impossible), never for game outcomes.
 * See 01-architecture.md section 3.3.
 */

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}
