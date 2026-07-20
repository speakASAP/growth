import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { BatchTooLarge, EnvelopeInvalid, IngestService, MAX_BATCH_SIZE } from './ingest.service';

/**
 * C-005 §3. The endpoint returns 202 only after the buffer transaction has committed.
 *
 * Acknowledging before the write is precisely the loss this slice exists to prevent, so there is
 * deliberately no fire-and-forget path here: if the buffer is unwritable the caller gets a 503
 * and retries with the same eventId, which the primary key makes safe.
 */
@Controller('ingest')
export class IngestController {
  private readonly logger = new Logger(IngestController.name);

  constructor(private readonly ingest: IngestService) {}

  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  async ingestEvents(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accepted: number; duplicates: number }> {
    const batch = Array.isArray(body) ? body : [body];

    try {
      const result = await this.ingest.ingest(batch);

      // Every envelope was already present: the client is retrying something that landed.
      // 200 rather than 202 tells it to stop, without treating the retry as an error.
      if (result.accepted === 0 && result.duplicates > 0) {
        res.status(HttpStatus.OK);
      }

      return { accepted: result.accepted, duplicates: result.duplicates };
    } catch (err) {
      if (err instanceof BatchTooLarge) {
        throw new PayloadTooLargeException({
          message: `batch of ${err.size} exceeds the maximum of ${MAX_BATCH_SIZE} envelopes`,
          size: err.size,
        });
      }
      if (err instanceof EnvelopeInvalid) {
        // 400, and the client must not retry: a schema violation is not transient.
        throw new BadRequestException({ message: err.message, failures: err.failures });
      }

      // Anything else is the buffer being unwritable. 503 asks for a retry with the same
      // eventId — the one response that keeps the event alive rather than dropping it.
      this.logger.error(`ingest failed, buffer unwritable: ${(err as Error).message}`);
      throw new ServiceUnavailableException('event buffer unavailable, retry with the same eventId');
    }
  }
}
