/**
 * `AppError` and the Fastify error handler (01-architecture.md section 3.3).
 *
 * THREE FAMILIES, NEVER MIXED. `RuleViolation` belongs to the engine and comes
 * back as a `Result`, never as an exception; `AppError` says the request could
 * not be served; everything else is a bug and is answered `internal_error`
 * with a generic French sentence and a `requestId` an operator can grep.
 *
 * `details` NEVER CROSSES TO THE CLIENT. It is the field where a stack, a SQL
 * message or a rejected payload lands, and all three are things a public
 * deployment hands to an attacker for free. The wire payload is exactly
 * `zAppErrorPayload`: `{ code, message, requestId }`, plus `intentId` when the
 * error answers one.
 */

import { zAppErrorPayload } from '@for/contracts';

import type { AppErrorCode, AppErrorPayload } from '@for/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    readonly httpStatus: number,
    /** French, showable to a player. */
    readonly userMessage: string,
    /** Stays in the log. Never serialised to the client. */
    readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'AppError';
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** 401 — no session, or a session that no longer exists. */
export function unauthenticated(details?: unknown): AppError {
  return new AppError('unauthenticated', 401, 'Connecte-toi pour accéder à cette page.', details);
}

/** 404 — a route the server does not serve. */
export function routeNotFound(details?: unknown): AppError {
  return new AppError('route_not_found', 404, "Cette adresse n'existe pas.", details);
}

/** 400 — a payload that failed validation at the edge. */
export function validationFailed(details?: unknown): AppError {
  return new AppError('validation_failed', 400, 'La requête est mal formée.', details);
}

const GENERIC_MESSAGE = 'Une erreur interne est survenue. Réessaie dans un instant.';

/**
 * Turns anything thrown inside a route into an `AppError`.
 *
 * A Fastify validation failure and a 404 are given their own codes so the
 * client can react; everything else collapses to `internal_error`, which is
 * the point — an unexpected error has no vocabulary of its own.
 */
function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  const candidate = error as Partial<FastifyError> | null;
  if (candidate?.validation !== undefined) {
    return validationFailed(candidate.validation);
  }
  if (candidate?.statusCode === 404) {
    return routeNotFound(candidate.message);
  }
  return new AppError('internal_error', 500, GENERIC_MESSAGE, error, { cause: error });
}

function payloadFor(error: AppError, requestId: string): AppErrorPayload {
  // Parsed rather than cast: the answer the client gets is the answer the
  // contract describes, and a code that drifted out of the closed union would
  // throw here instead of reaching a browser.
  return zAppErrorPayload.parse({
    code: error.code,
    message: error.userMessage,
    requestId,
  });
}

/**
 * The single error handler `app.ts` installs. 5xx is logged with its stack,
 * 4xx at `warn`: a client asking for something it may not have is expected
 * traffic, not an incident.
 */
export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const appError = toAppError(error);
  const line = { code: appError.code, details: appError.details, err: appError };

  if (appError.httpStatus >= 500) {
    request.log.error(line, appError.message);
  } else {
    request.log.warn(line, appError.message);
  }

  void reply.status(appError.httpStatus).send(payloadFor(appError, request.id));
}

/** The 404 handler, so an unknown route answers the same shape as anything else. */
export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  const error = routeNotFound(`${request.method} ${request.url}`);
  void reply.status(error.httpStatus).send(payloadFor(error, request.id));
}

/** Installs both on an instance. Called once, from `buildApp`. */
export function installErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);
}
