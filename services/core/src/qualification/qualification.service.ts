import { Injectable, Logger } from '@nestjs/common';
import { QualificationRepository } from './qualification.repository';

interface LeadCreatedEnvelope {
  workspaceId: string;
  payload: {
    leadId: string;
    userId: string;
    correlationId?: string;
    sourceService: string;
    createdAt: string;
  };
}

interface QualificationEnvelope {
  workspaceId: string;
  payload: {
    qualificationId: string;
    leadId: string;
    criteriaVersion: string;
    qualificationStatus: 'qualified' | 'disqualified';
    decidedByType: string;
    decidedById: string;
    decidedAt: string;
    reason: string;
    supersedesQualificationId?: string;
  };
}

/**
 * Consumes the lead and the judgement about it (C-006 §3).
 *
 * This service records; it never decides. `criteriaVersion: v1-owner-manual` means a human looked
 * at a lead and formed a view, and there is deliberately no rule, no score and no model anywhere
 * in this path. If one is ever wanted, the `const`s in the contract schema make it a contract
 * change rather than a quiet addition here.
 */
@Injectable()
export class QualificationService {
  private readonly logger = new Logger(QualificationService.name);

  constructor(private readonly repository: QualificationRepository) {}

  async onLeadCreated(envelope: LeadCreatedEnvelope): Promise<void> {
    await this.repository.saveLead({
      leadId: envelope.payload.leadId,
      userId: envelope.payload.userId,
      // Absent for a registration that did not come through a growth landing. Expected, not an
      // error — and it is exactly what makes a lead unattributed in the split.
      correlationId: envelope.payload.correlationId ?? null,
      workspaceId: envelope.workspaceId,
      sourceService: envelope.payload.sourceService,
      createdAt: envelope.payload.createdAt,
    });
  }

  async onQualificationRecorded(envelope: QualificationEnvelope): Promise<void> {
    const inserted = await this.repository.saveQualification({
      qualificationId: envelope.payload.qualificationId,
      leadId: envelope.payload.leadId,
      workspaceId: envelope.workspaceId,
      criteriaVersion: envelope.payload.criteriaVersion,
      qualificationStatus: envelope.payload.qualificationStatus,
      decidedByType: envelope.payload.decidedByType,
      decidedById: envelope.payload.decidedById,
      decidedAt: envelope.payload.decidedAt,
      reason: envelope.payload.reason,
      supersedesQualificationId: envelope.payload.supersedesQualificationId ?? null,
    });

    if (inserted > 0) {
      // No reason text in the log: it is free text a human wrote about a person, and it is already
      // stored where it belongs.
      this.logger.log(
        `qualification ${envelope.payload.qualificationId} recorded for lead ` +
          `${envelope.payload.leadId}: ${envelope.payload.qualificationStatus}`,
      );
    }
  }
}
