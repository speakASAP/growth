import { QualificationService } from './qualification.service';

function build() {
  const leads: unknown[] = [];
  const qualifications: unknown[] = [];

  const repository = {
    saveLead: jest.fn(async (record: unknown) => {
      leads.push(record);
    }),
    saveQualification: jest.fn(async (record: unknown) => {
      qualifications.push(record);
      return 1;
    }),
  };

  return { service: new QualificationService(repository as never), repository, leads, qualifications };
}

const leadCreated = (correlationId?: string) => ({
  eventType: 'growth.lead.created_from_registration.v1',
  workspaceId: 'bazos',
  correlationId: 'envelope-trace',
  payload: {
    leadId: 'lead-1',
    userId: 'user-1',
    correlationId,
    sourceService: 'auth-microservice',
    createdAt: '2026-07-22T10:00:00.000Z',
  },
});

const qualificationRecorded = (overrides: Record<string, unknown> = {}) => ({
  eventType: 'growth.lead.qualification_recorded.v1',
  workspaceId: 'bazos',
  correlationId: 'lead-1',
  payload: {
    qualificationId: 'q-1',
    leadId: 'lead-1',
    criteriaVersion: 'v1-owner-manual',
    qualificationStatus: 'qualified',
    decidedByType: 'human',
    decidedById: 'admin-7',
    decidedAt: '2026-07-22T11:00:00.000Z',
    reason: 'Odpověděl na WhatsApp.',
    ...overrides,
  },
});

describe('consuming a lead', () => {
  it('stores the lead with its correlation to the touchpoint', async () => {
    const { service, leads } = build();

    await service.onLeadCreated(leadCreated('corr-1') as never);

    expect(leads[0]).toEqual({
      leadId: 'lead-1',
      userId: 'user-1',
      correlationId: 'corr-1',
      workspaceId: 'bazos',
      sourceService: 'auth-microservice',
      createdAt: '2026-07-22T10:00:00.000Z',
    });
  });

  // A registration that did not come through a growth landing has no correlation. That is the
  // unattributed half of the split, and it is normal — not an error and not a reason to drop it.
  it('stores a lead with no correlationId as null rather than refusing it', async () => {
    const { service, leads } = build();

    await service.onLeadCreated(leadCreated(undefined) as never);

    expect((leads[0] as { correlationId: unknown }).correlationId).toBeNull();
  });
});

describe('consuming a judgement', () => {
  it('stores what the human decided, unchanged', async () => {
    const { service, qualifications } = build();

    await service.onQualificationRecorded(qualificationRecorded() as never);

    expect(qualifications[0]).toEqual({
      qualificationId: 'q-1',
      leadId: 'lead-1',
      workspaceId: 'bazos',
      criteriaVersion: 'v1-owner-manual',
      qualificationStatus: 'qualified',
      decidedByType: 'human',
      decidedById: 'admin-7',
      decidedAt: '2026-07-22T11:00:00.000Z',
      reason: 'Odpověděl na WhatsApp.',
      supersedesQualificationId: null,
    });
  });

  it('carries the superseded id through when the judgement is a correction', async () => {
    const { service, qualifications } = build();

    await service.onQualificationRecorded(
      qualificationRecorded({ qualificationId: 'q-2', supersedesQualificationId: 'q-1' }) as never,
    );

    expect((qualifications[0] as { supersedesQualificationId: unknown }).supersedesQualificationId).toBe('q-1');
  });

  // C-006 §3.1: two queues, two drain rates. A judgement about a lead that has not arrived yet is
  // stored anyway — the judgement is the scarcer fact, and it joins by lead_id at read time.
  it('stores a judgement for a lead it has never seen', async () => {
    const { service, qualifications, leads } = build();

    await service.onQualificationRecorded(qualificationRecorded({ leadId: 'lead-unknown' }) as never);

    expect(leads).toHaveLength(0);
    expect(qualifications).toHaveLength(1);
  });

  // The service records; it never decides. Nothing in this path may compute a verdict.
  it('does not derive a verdict of its own', async () => {
    const { service, qualifications } = build();

    await service.onQualificationRecorded(qualificationRecorded({ qualificationStatus: 'disqualified' }) as never);

    expect((qualifications[0] as { qualificationStatus: unknown }).qualificationStatus).toBe('disqualified');
    expect((qualifications[0] as { decidedByType: unknown }).decidedByType).toBe('human');
  });
});
