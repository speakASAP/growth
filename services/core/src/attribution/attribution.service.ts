import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttributionRepository } from './attribution.repository';
import { verifyGsid } from './gsid';

interface RedirectEnvelope {
  workspaceId: string;
  correlationId: string;
  payload: {
    correlationId: string;
    gsid?: string;
    gsidSource?: string;
    initiatedAt: string;
  };
}

interface TouchpointEnvelope {
  eventId: string;
  workspaceId: string;
  occurredAt: string;
  payload: {
    sessionId: string;
    experimentId: string;
    experimentVersion: string;
    landingVersionId: string;
    gclid?: string;
    utm?: { campaign?: string };
    consentEvidence: { statusAtEventTime: string };
  };
}

interface RegistrationEnvelope {
  correlationId: string;
  payload: {
    userId: string;
    correlationId?: string;
    registrationMethod: string;
    applicationContext?: string;
    registeredAt: string;
  };
}

/**
 * Joins the click to the registration (C-005 §2.2).
 *
 * `bazos-service` records that someone clicked through to auth; `auth-microservice` records the
 * registration that may follow. Neither knows about the other, and the two travel different
 * queues, so **either may arrive first and either may arrive alone**. Both halves are stored on
 * arrival and each one then asks whether its partner is already here — which makes the order
 * irrelevant and a missing partner a normal state rather than an error.
 *
 * ### On "sessionId known" (C-005 §4)
 *
 * The contract distinguishes a verified session that growth-core knows from one it does not, and
 * only links the former. Touchpoints — the thing that would make a session "known" — arrive with
 * W2, which is not built. Until then the click record itself is taken as evidence the session
 * existed: it is a signed token this service issued the secret for, delivered by our own producer.
 * When W2 lands, a session with no touchpoint becomes the `gsid_orphan` case and this is where
 * that check belongs.
 */
@Injectable()
export class AttributionService {
  private readonly logger = new Logger(AttributionService.name);

  constructor(
    private readonly repository: AttributionRepository,
    private readonly config: ConfigService,
  ) {}

  private get secret(): string {
    return this.config.get<string>('GROWTH_GSID_HMAC_SECRET') ?? '';
  }

  async onAuthRedirect(envelope: RedirectEnvelope): Promise<void> {
    const correlationId = envelope.payload.correlationId;
    const verification = verifyGsid(envelope.payload.gsid, this.secret);

    if (verification.status === 'forged') {
      // C-005 §4: someone is editing attribution parameters. This has to be visible — the
      // corrupted signal would otherwise flow straight into budget decisions.
      this.logger.warn(
        `gsid_forged: signature did not verify for correlationId ${correlationId} — ` +
          `attribution dropped, registration unaffected`,
      );
    }

    await this.repository.saveRedirect({
      correlationId,
      workspaceId: envelope.workspaceId,
      // Only a verified session is stored. An unverified one is not evidence of anything.
      sessionId: verification.status === 'valid' ? verification.sessionId : null,
      gsidStatus: verification.status,
      initiatedAt: envelope.payload.initiatedAt,
    });

    await this.link(correlationId);
  }

  /**
   * C-006 §4.3 — stores the landing view so a lead's experiment can be derived later.
   *
   * Nothing is joined here. A touchpoint arrives before the click and long before the lead, so
   * resolving anything at this point would resolve it against facts that have not happened yet;
   * the report walks session → experiment at read time instead (C-006 §6.6).
   */
  async onTouchpoint(envelope: TouchpointEnvelope): Promise<void> {
    const p = envelope.payload;

    await this.repository.saveTouchpoint({
      touchpointId: envelope.eventId,
      sessionId: p.sessionId,
      workspaceId: envelope.workspaceId,
      experimentId: p.experimentId,
      experimentVersion: p.experimentVersion,
      landingVersionId: p.landingVersionId,
      utmCampaign: p.utm?.campaign ?? null,
      gclid: p.gclid ?? null,
      consentStatus: p.consentEvidence.statusAtEventTime,
      occurredAt: envelope.occurredAt,
    });
  }

  async onUserRegistered(envelope: RegistrationEnvelope): Promise<void> {
    // The join key is the payload's correlationId, never the envelope's: the envelope one is a
    // tracing id auth generates for every registration, including direct signups that passed no
    // landing page. Joining on it would match registrations to clicks at random.
    const correlationId = envelope.payload.correlationId ?? null;

    await this.repository.saveRegistration({
      userId: envelope.payload.userId,
      correlationId,
      registrationMethod: envelope.payload.registrationMethod,
      applicationContext: envelope.payload.applicationContext ?? null,
      registeredAt: envelope.payload.registeredAt,
    });

    if (correlationId) await this.link(correlationId);
  }

  private async link(correlationId: string): Promise<void> {
    const linked = await this.repository.linkIfComplete(correlationId);
    if (linked > 0) {
      this.logger.log(`identity linked for correlationId ${correlationId}`);
    }
  }
}
