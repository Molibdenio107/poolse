import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * A malformed id is a 404, not a crash — POOLSE-R3-01.
 *
 * `/facilities/not-a-uuid` reached Postgres as a `uuid` and came back as
 * `22P02: invalid input syntax for type uuid`, which carries no HTTP status, so
 * Nest answered 500. A well-formed id that does not exist already 404s, and a
 * truncated link out of an email is not a server fault — it is the same "no such
 * thing" with a worse-looking cause.
 *
 * **Why a filter rather than validating each route.** Every id in this API comes
 * off a path and goes to a `uuid` column; there are dozens of them, and the one
 * somebody forgets is the one that 500s. Catching the database's own complaint
 * covers all of them, including the routes not written yet.
 *
 * **Why it distinguishes.** Mapping every `22P02` to 404 would hide a genuinely
 * bad *body* value behind "not found" — a real request that a developer then
 * cannot diagnose. The offending text is in the message, so the filter asks
 * whether it came out of the route's own parameters: from the path it is a 404,
 * from anywhere else it is a 400. Either way the original is logged, because a
 * mapped error that leaves no trace is the next hour somebody loses.
 */
@Catch()
export class BadInputFilter implements ExceptionFilter {
  private readonly logger = new Logger('BadInput');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    const mapped = this.translate(exception, request);
    if (mapped === null) {
      // Not ours. Anything already carrying a status keeps it, and a genuine
      // fault stays a 500 — swallowing those is how an outage looks healthy.
      if (exception instanceof HttpException) {
        response.status(exception.getStatus()).json(exception.getResponse());
        return;
      }
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      response
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ statusCode: 500, message: 'Internal server error' });
      return;
    }

    response.status(mapped.getStatus()).json(mapped.getResponse());
  }

  private translate(exception: unknown, request: Request): HttpException | null {
    if (!isBadTextRepresentation(exception)) return null;

    const offending = offendingValue(exception.message);
    const fromPath =
      offending !== null &&
      Object.values((request.params ?? {}) as Record<string, string>).includes(offending);

    this.logger.warn(
      `${request.method} ${request.url} — ${exception.message} ` +
        `(${fromPath ? 'route parameter, answering 404' : 'not a route parameter, answering 400'})`,
    );

    return fromPath
      ? new NotFoundException('No such record')
      : new BadRequestException('A value in the request was not of the expected type');
  }
}

/** Postgres 22P02 — "invalid input syntax for type …". */
function isBadTextRepresentation(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error && (error as { code?: unknown }).code === '22P02'
  );
}

/**
 * The value Postgres refused, out of its own message.
 *
 * `invalid input syntax for type uuid: "not-a-uuid"` — the quoted tail. Read
 * rather than assumed: comparing against every route parameter blindly would
 * call a bad body value a 404 whenever some unrelated path segment happened to
 * be malformed too.
 */
function offendingValue(message: string): string | null {
  const match = /:\s*"(.*)"\s*$/.exec(message);
  return match?.[1] ?? null;
}
