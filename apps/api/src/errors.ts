import { ApiErrorCodes, type ApiErrorCode } from '@discord-bot/shared';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(400, ApiErrorCodes.BadRequest, message, details);
  }

  static unauthorized(message = 'Unauthorized'): HttpError {
    return new HttpError(401, ApiErrorCodes.Unauthorized, message);
  }

  static forbidden(message = 'Forbidden'): HttpError {
    return new HttpError(403, ApiErrorCodes.Forbidden, message);
  }

  static notFound(message = 'Not found'): HttpError {
    return new HttpError(404, ApiErrorCodes.NotFound, message);
  }

  static conflict(message: string): HttpError {
    return new HttpError(409, ApiErrorCodes.Conflict, message);
  }
}
