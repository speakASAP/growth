import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ManualSpendPayload, ObservationInvalid, SpendService } from '../spend/spend.service';
import { ExperimentReportService } from './experiment-report.service';
import { renderExperimentScreen } from './render';

/**
 * C-006 §6 — the read API and the owner's screen.
 *
 * Unauthenticated, like every other surface here, because `growth-core` is ClusterIP only and has
 * no ingress. **Do not add these paths to an ingress.** This screen shows spend and lead counts,
 * and the only publicly routed container in this platform (`growth-web`, on
 * `bazos.alfares.cz/l`) has no authentication at all — putting the screen there would publish the
 * owner's numbers to anyone who guessed the path. See C-006 §6.7/§6.8.
 *
 * The owner reaches it with:
 *   kubectl -n statex-apps port-forward deploy/growth-core 3376:3376
 *   open http://localhost:3376/experiments/exp-001
 */
@Controller('experiments')
export class ExperimentReportController {
  private readonly logger = new Logger(ExperimentReportController.name);

  constructor(
    private readonly report: ExperimentReportService,
    private readonly spend: SpendService,
    private readonly config: ConfigService,
  ) {}

  /** The read API. 200 with zeroes for an experiment that has no data — never 404. */
  @Get(':experimentId/report')
  async json(@Param('experimentId') experimentId: string) {
    return this.report.build(experimentId);
  }

  @Get(':experimentId')
  async screen(@Param('experimentId') experimentId: string, @Res() res: Response) {
    const report = await this.report.build(experimentId);

    return res
      // The numbers change as leads are worked; a cached page would show the owner a stale
      // cost-per-qualified and give him no reason to doubt it.
      .set('Cache-Control', 'no-store, max-age=0')
      .type('html')
      .send(renderExperimentScreen(report));
  }

  /**
   * The form target. Delegates to the same `SpendService` as `POST /spend/observations` rather
   * than reimplementing intake — one validation path, one durability path.
   *
   * POST-redirect-GET so a browser refresh does not re-submit. The `observationId` is minted here
   * because an observation is identified by the entry, not by its contents: two genuinely separate
   * spend entries for the same day and amount are two observations, not a duplicate.
   */
  @Post(':experimentId/spend')
  async submit(
    @Param('experimentId') experimentId: string,
    @Body() form: Record<string, string>,
    @Res() res: Response,
  ) {
    const workspaceId = this.config.get<string>('GROWTH_WORKSPACE_ID') ?? 'bazos';

    const payload: ManualSpendPayload = {
      observationId: randomUUID(),
      experimentId,
      // Empty means "not split by campaign", which is a real answer and the common one. The blank
      // string itself never reaches the payload: the schema rejects it, and an absent field is the
      // shape that means unassigned (C-006 §2.5).
      campaignId: String(form?.campaignId ?? '').trim() || undefined,
      platform: 'google_ads',
      periodStart: String(form?.periodStart ?? ''),
      periodEnd: String(form?.periodEnd ?? ''),
      amount: {
        // Straight through as typed. Any normalising here — trimming a stray character, coercing
        // through Number to "clean it up" — is how a float gets into the money path.
        value: String(form?.amountValue ?? ''),
        currency: String(form?.amountCurrency ?? '').toUpperCase(),
      },
      evidenceReference: String(form?.evidenceReference ?? ''),
      enteredBy: String(form?.enteredBy ?? ''),
      enteredAt: new Date().toISOString(),
      isManual: true,
    };

    try {
      await this.spend.record(payload, workspaceId);
    } catch (err) {
      if (err instanceof ObservationInvalid) {
        throw new BadRequestException({ message: err.message, failures: err.failures });
      }
      this.logger.error(`spend entry from the screen failed: ${(err as Error).message}`);
      throw err;
    }

    return res.redirect(303, `/experiments/${encodeURIComponent(experimentId)}`);
  }
}
