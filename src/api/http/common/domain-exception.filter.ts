import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../../../domain/errors/domain-error.js';
import { WalletLockRetryExhaustedError } from '../../../application/wallet/wallet-lock-retry-policy.js';
import {
  ExternalTransactionIdempotencyMismatchError,
  IdempotencyPayloadConflictError,
  WalletNotFoundError,
  WalletOwnershipMismatchError,
} from '../../../application/wagering/wagering-application.errors.js';
import {
  InvalidLedgerCursorError,
  WalletAlreadyExistsError,
} from '../../../application/wallet/wallet-application.errors.js';
import { WagerTransactionNotFoundError } from '../../../application/wagering/wager-transaction-query.service.js';

const NOT_FOUND_ERRORS = [WalletNotFoundError, WagerTransactionNotFoundError];
const CONFLICT_ERRORS = [
  WalletAlreadyExistsError,
  IdempotencyPayloadConflictError,
  ExternalTransactionIdempotencyMismatchError,
];
const BAD_REQUEST_ERRORS = [WalletOwnershipMismatchError, InvalidLedgerCursorError];

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    if (exception instanceof WalletLockRetryExhaustedError) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        failureCode: 'INFRASTRUCTURE_TRANSIENT_FAILURE',
        message: exception.message,
      });
      return;
    }

    if (matches(exception, NOT_FOUND_ERRORS)) {
      response.status(HttpStatus.NOT_FOUND).json(asBody(HttpStatus.NOT_FOUND, exception));
      return;
    }

    if (matches(exception, CONFLICT_ERRORS)) {
      response.status(HttpStatus.CONFLICT).json(asBody(HttpStatus.CONFLICT, exception));
      return;
    }

    if (matches(exception, BAD_REQUEST_ERRORS) || exception instanceof DomainError) {
      response.status(HttpStatus.BAD_REQUEST).json(asBody(HttpStatus.BAD_REQUEST, exception));
      return;
    }

    this.logger.error(
      'unhandled exception',
      exception instanceof Error ? exception.stack : exception,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'internal server error',
    });
  }
}

function matches(
  exception: unknown,
  candidates: ReadonlyArray<new (...args: never[]) => Error>,
): boolean {
  return candidates.some((candidate) => exception instanceof candidate);
}

function asBody(statusCode: number, exception: unknown): Record<string, unknown> {
  return {
    statusCode,
    message: exception instanceof Error ? exception.message : 'unexpected error',
  };
}
