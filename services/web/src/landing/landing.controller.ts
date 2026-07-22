import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { TouchpointEmitter } from './touchpoint.emitter';
import {
  buildGsidCookie,
  buildPaymentIntentEnvelope,
  buildTouchpointEnvelope,
  ConsentDecision,
  consentEvidenceFrom,
  sessionIdFromGsidCookie,
} from './landing';
import { renderLanding } from './landing.assets';
import { findVariant } from './variants';

interface ConsentBody {
  decision?: ConsentDecision;
  landingVersionId?: string;
  query?: Record<string, string | undefined>;
  referrer?: string;
}

/**
 * The experiment landing (EP-005 W2).
 *
 * Served under `bazos.alfares.cz` so the `gsid` cookie it sets reaches `bazos-service`, which
 * reads it when the visitor clicks through to registration (F-005 Q1). A different host would
 * leave attribution permanently empty while everything reported healthy — see D-005.
 */
@Controller()
export class LandingController {
  private readonly logger = new Logger(LandingController.name);

  constructor(
    private readonly emitter: TouchpointEmitter,
    private readonly config: ConfigService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'growth-web', timestamp: new Date().toISOString() };
  }

  @Get('l/:landingVersionId')
  landing(@Param('landingVersionId') landingVersionId: string, @Res() res: any) {
    // A variant is an immutable clone: it is never edited in place, so the id in the URL is also
    // the id recorded on every touchpoint it produces (F-005 §1).
    const variant = findVariant(landingVersionId);

    // No fallback to a default. Serving some other variant under an unknown id would record
    // touchpoints against copy the visitor never read, and the experiment would then be comparing
    // pages nobody saw — a result that looks like data and is not. A broken ad URL should be
    // obviously broken.
    if (!variant) {
      throw new NotFoundException(`unknown landing version: ${landingVersionId}`);
    }

    return res
      .set('Cache-Control', 'no-store, max-age=0')
      .type('html')
      .send(renderLanding(variant));
  }

  /**
   * The consent gate.
   *
   * Nothing is issued and nothing is recorded before this returns granted. That is stronger than
   * "no cookie": a measurement taken without permission cannot be withdrawn once it exists, so
   * the session itself is minted here rather than on page load.
   */
  // POST only. Consent is a state change, and a URL a browser can prefetch or a crawler can
  // follow must never be able to grant it.
  @Post('l/consent')
  @HttpCode(204)
  // `passthrough: true` matters: with a bare @Res() Nest hands the response over entirely and
  // this method would have to end it itself. It sets a header and returns, so without passthrough
  // the request hangs until the edge times out — which is exactly what happened on first deploy,
  // and no unit test could see it because they call this method with a fake response object.
  async consent(
    @Body() body: ConsentBody,
    @Req() _req: any,
    @Res({ passthrough: true }) res: any,
  ): Promise<void> {
    const decision = body?.decision;

    // Absent, malformed, or necessary-only all mean the same thing: do not collect. The safe
    // default when something is missing is refusal, never consent.
    if (!decision?.categories || consentEvidenceFrom(decision).statusAtEventTime !== 'granted') {
      return;
    }

    const sessionId = randomUUID();
    const secret = this.config.get<string>('GROWTH_GSID_HMAC_SECRET') ?? '';

    res.setHeader('Set-Cookie', buildGsidCookie(sessionId, secret));

    try {
      await this.emitter.emit(
        buildTouchpointEnvelope({
          sessionId,
          experimentId: this.config.get<string>('GROWTH_EXPERIMENT_ID') ?? 'unknown',
          experimentVersion: this.config.get<string>('GROWTH_EXPERIMENT_VERSION') ?? 'unknown',
          landingVersionId: body.landingVersionId ?? 'unknown',
          workspaceId: this.config.get<string>('GROWTH_WORKSPACE_ID') ?? 'bazos',
          query: body.query ?? {},
          referrer: body.referrer,
          consent: decision,
          now: new Date(),
          eventId: randomUUID(),
        }),
      );
    } catch (err) {
      // The visitor is looking at a page. An ingestion outage degrades to a missing measurement,
      // never to a landing that does not work.
      this.logger.warn(`could not record the touchpoint: ${describe(err)}`);
    }
  }

  /**
   * The visitor clicked the priced button.
   *
   * **Nothing is charged and no payment details are asked for.** This records that someone said
   * yes at 49 Kč — the question the whole experiment exists to answer — and the page then shows
   * them the launch offer. Always 204: the offer must appear whether or not we managed to measure
   * anything, and a visitor who refused consent still gets it, they are simply not counted.
   */
  @Post('l/intent')
  @HttpCode(204)
  async intent(@Body() body: ConsentBody, @Req() req: any): Promise<void> {
    const secret = this.config.get<string>('GROWTH_GSID_HMAC_SECRET') ?? '';
    // From the cookie, not from the page: it is HttpOnly, so the browser cannot tell us a session
    // and cannot invent one either.
    const sessionId = sessionIdFromGsidCookie(req?.headers?.cookie, secret);

    // No verified session means no consent was given. The offer is still shown; the intent is
    // simply not recorded, because measuring it would be measuring someone who said no.
    if (!sessionId) return;

    try {
      await this.emitter.emit(
        buildPaymentIntentEnvelope({
          sessionId,
          experimentId: this.config.get<string>('GROWTH_EXPERIMENT_ID') ?? 'unknown',
          experimentVersion: this.config.get<string>('GROWTH_EXPERIMENT_VERSION') ?? 'unknown',
          landingVersionId: body.landingVersionId ?? 'unknown',
          workspaceId: this.config.get<string>('GROWTH_WORKSPACE_ID') ?? 'bazos',
          priceValue: this.config.get<string>('GROWTH_PRICE_VALUE') ?? '49.00',
          priceCurrency: this.config.get<string>('GROWTH_PRICE_CURRENCY') ?? 'CZK',
          now: new Date(),
          eventId: randomUUID(),
        }),
      );
    } catch (err) {
      this.logger.warn(`could not record the payment intent: ${describe(err)}`);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
