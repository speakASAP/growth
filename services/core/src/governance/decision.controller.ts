import {
  Body,
  ConflictException,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Response } from 'express';
import { DecisionService } from './decision.service';
import { StoredArtefact } from './decision-artefact.types';

@Controller('governance/decisions')
export class DecisionController {
  constructor(private readonly decisions: DecisionService) {}

  /**
   * C-001 section 4. No batching: decisions are low-volume, deliberate acts.
   *
   * 201 created / 200 duplicate / 409 conflict / 422 validation failure. The 200-on-duplicate
   * is what makes a client-generated decisionArtefactId safe to retry.
   */
  @Post()
  async record(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const outcome = await this.decisions.record(body);

    switch (outcome.status) {
      case 'created':
        res.status(201);
        return outcome.artefact;
      case 'duplicate':
        res.status(200);
        return outcome.artefact;
      case 'conflict':
        throw new ConflictException(outcome.message);
      case 'invalid':
        throw new UnprocessableEntityException({
          message: 'artefact rejected',
          failures: outcome.failures,
        });
    }
  }

  /** Launch → budget changes → stop, in decided order, so the pair reads as one story. */
  @Get()
  async list(
    @Query('experimentId') experimentId: string,
    @Query('experimentVersion') experimentVersion?: string,
  ): Promise<StoredArtefact[]> {
    if (!experimentId || !experimentId.trim()) {
      throw new UnprocessableEntityException('experimentId is required');
    }
    return this.decisions.listForExperiment(experimentId, experimentVersion);
  }
}
