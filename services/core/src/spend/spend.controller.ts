import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import {
  ManualSpendPayload,
  ObservationConflict,
  ObservationInvalid,
  SpendService,
} from './spend.service';
import { SpendRepository } from './spend.repository';

/**
 * C-006 §2.1 — the owner's manual spend entry.
 *
 * Unauthenticated, like every other surface on this service, because `growth-core` is ClusterIP
 * only and has no ingress. The absence of a public route is the access control until S1b adds an
 * authenticated surface — see the repository CLAUDE.md. Do not add this path to an ingress.
 */
@Controller('spend')
export class SpendController {
  private readonly logger = new Logger(SpendController.name);

  constructor(
    private readonly spend: SpendService,
    private readonly repository: SpendRepository,
    private readonly config: ConfigService,
  ) {}

  @Post('observations')
  @HttpCode(HttpStatus.CREATED)
  async record(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const workspaceId = this.config.get<string>('GROWTH_WORKSPACE_ID') ?? 'bazos';

    try {
      const result = await this.spend.record(body as ManualSpendPayload, workspaceId);

      // Already stored. 200 rather than 201 tells the caller it landed the first time, without
      // treating a retry as an error.
      if (result.status === 'duplicate') res.status(HttpStatus.OK);

      return result;
    } catch (err) {
      if (err instanceof ObservationInvalid) {
        // Not transient: a schema violation will fail identically on retry.
        throw new BadRequestException({ message: err.message, failures: err.failures });
      }
      if (err instanceof ObservationConflict) {
        // The same id with a different body. Refused loudly rather than silently kept as the old
        // value — a correction the owner believes landed, and which did not, makes every cost
        // metric downstream quietly wrong.
        throw new ConflictException({
          message: err.message,
          observationId: err.observationId,
          hint: 'a correction is a NEW observationId; the stored one is never overwritten',
        });
      }

      this.logger.error(`spend observation failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('spend store unavailable, retry with the same observationId');
    }
  }

  @Get('observations/:experimentId')
  async list(@Param('experimentId') experimentId: string) {
    return { items: await this.repository.listForExperiment(experimentId) };
  }
}
