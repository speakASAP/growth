import { Client } from 'pg';
import { DatabaseService } from '../db/database.service';
import { QualificationRepository } from './qualification.repository';

/**
 * Requires the throwaway Postgres from scripts/test-db.sh.
 *
 * The behaviour worth proving against a real database rather than a mock: a judgement survives
 * arriving before its lead, `pending` is genuinely derived, the current verdict is the latest one
 * deterministically, and the runtime role cannot rewrite a judgement even though it wrote it.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://testuser:testpw@127.0.0.1:55432/growth_core_test';
const RUNTIME_DATABASE_URL =
  process.env.TEST_RUNTIME_DATABASE_URL ??
  'postgresql://growth_core:testpw@127.0.0.1:55432/growth_core_test';

let client: Client;
let runtime: Client;
let repository: QualificationRepository;

beforeAll(async () => {
  client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  runtime = new Client({ connectionString: RUNTIME_DATABASE_URL });
  await runtime.connect();

  repository = new QualificationRepository({
    query: (text: string, params?: unknown[]) => client.query(text, params as never),
  } as unknown as DatabaseService);
});

afterAll(async () => {
  await client.end();
  await runtime.end();
});

beforeEach(async () => {
  await client.query('TRUNCATE qualification.lead_qualification, qualification.lead');
  await client.query(
    'TRUNCATE attribution.identity_link, attribution.registration, attribution.auth_redirect, attribution.touchpoint',
  );
});

const lead = (leadId: string, correlationId: string | null = null, userId = `user-${leadId}`) => ({
  leadId,
  userId,
  correlationId,
  workspaceId: 'bazos',
  sourceService: 'auth-microservice',
  createdAt: '2026-07-22T10:00:00.000Z',
});

const judgement = (
  qualificationId: string,
  leadId: string,
  status: 'qualified' | 'disqualified',
  decidedAt: string,
) => ({
  qualificationId,
  leadId,
  workspaceId: 'bazos',
  criteriaVersion: 'v1-owner-manual',
  qualificationStatus: status,
  decidedByType: 'human',
  decidedById: 'admin-7',
  decidedAt,
  reason: `because ${qualificationId}`,
  supersedesQualificationId: null,
});

describe('storing leads and judgements', () => {
  it('is idempotent on redelivery of the same lead', async () => {
    await repository.saveLead(lead('lead-1'));
    await repository.saveLead(lead('lead-1'));

    const { rows } = await client.query('SELECT count(*)::int AS n FROM qualification.lead');
    expect(rows[0].n).toBe(1);
  });

  it('is idempotent on redelivery of the same judgement', async () => {
    await repository.saveLead(lead('lead-1'));
    expect(await repository.saveQualification(judgement('q-1', 'lead-1', 'qualified', '2026-07-22T11:00:00Z'))).toBe(1);
    // A second delivery inserts nothing, and says so — the caller uses that to avoid logging twice.
    expect(await repository.saveQualification(judgement('q-1', 'lead-1', 'qualified', '2026-07-22T11:00:00Z'))).toBe(0);
  });

  // C-006 §3.1 — the reason there is no foreign key. A judgement is the scarcer fact.
  it('stores a judgement whose lead has not arrived yet', async () => {
    await expect(
      repository.saveQualification(judgement('q-1', 'lead-not-here-yet', 'qualified', '2026-07-22T11:00:00Z')),
    ).resolves.toBe(1);
  });

  it('refuses a blank reason at the database, not only in the application', async () => {
    await repository.saveLead(lead('lead-1'));

    await expect(
      repository.saveQualification({
        ...judgement('q-1', 'lead-1', 'qualified', '2026-07-22T11:00:00Z'),
        reason: '   ',
      }),
    ).rejects.toThrow();
  });

  it('refuses a status outside the contract', async () => {
    await repository.saveLead(lead('lead-1'));

    await expect(
      repository.saveQualification({
        ...judgement('q-1', 'lead-1', 'qualified', '2026-07-22T11:00:00Z'),
        qualificationStatus: 'pending' as never,
      }),
    ).rejects.toThrow();
  });
});

describe('the current verdict', () => {
  it('reports a lead with no judgement as pending', async () => {
    await repository.saveLead(lead('lead-1'));

    const verdicts = await repository.currentVerdicts('bazos');
    // experimentId is null: this lead has no correlationId, so there is no click to walk back to
    // a landing view. Counted separately by the report, never against an experiment (C-006 §6.6).
    expect(verdicts).toEqual([
      { leadId: 'lead-1', verdict: 'pending', attributed: false, experimentId: null },
    ]);
  });

  it('reports the latest judgement, not the first', async () => {
    await repository.saveLead(lead('lead-1'));
    await repository.saveQualification(judgement('q-1', 'lead-1', 'qualified', '2026-07-22T11:00:00Z'));
    await repository.saveQualification(judgement('q-2', 'lead-1', 'disqualified', '2026-07-22T12:00:00Z'));

    const verdicts = await repository.currentVerdicts('bazos');
    expect(verdicts[0].verdict).toBe('disqualified');
  });

  // Both judgements stay. A history that kept only the current verdict would lose "we changed our
  // mind, and when", which is the entire point of the correction path.
  it('keeps the superseded judgement queryable', async () => {
    await repository.saveLead(lead('lead-1'));
    await repository.saveQualification(judgement('q-1', 'lead-1', 'qualified', '2026-07-22T11:00:00Z'));
    await repository.saveQualification({
      ...judgement('q-2', 'lead-1', 'disqualified', '2026-07-22T12:00:00Z'),
      supersedesQualificationId: 'q-1',
    });

    const history = await repository.history('lead-1');
    expect(history.map((row) => row.qualificationId)).toEqual(['q-2', 'q-1']);
    expect(history[0].supersedesQualificationId).toBe('q-1');
  });

  // C-006 §1.2 defines a correction by the edge it carries, not by its clock. These are the shapes
  // where the two disagree; each one silently moved costPerQualifiedLead before the chain was read.
  it('follows the correction chain rather than the later judgement that supersedes nothing', async () => {
    await repository.saveLead(lead('lead-1'));
    await repository.saveQualification(judgement('q-1', 'lead-1', 'qualified', '2026-07-22T11:00:00Z'));
    await repository.saveQualification({
      ...judgement('q-2', 'lead-1', 'disqualified', '2026-07-22T12:00:00Z'),
      supersedesQualificationId: 'q-1',
    });
    // Supersedes nothing, so it is a first judgement — a re-emission of one, not a correction of
    // the chain, however late its clock says it was decided.
    await repository.saveQualification(judgement('q-3', 'lead-1', 'qualified', '2026-07-22T13:00:00Z'));

    const verdicts = await repository.currentVerdicts('bazos');
    expect(verdicts[0].verdict).toBe('disqualified');
  });

  it('resolves a correction that shares its decided_at with what it supersedes', async () => {
    await repository.saveLead(lead('lead-1'));
    // Correction stored first: received_at cannot break this tie either.
    await repository.saveQualification({
      ...judgement('q-2', 'lead-1', 'disqualified', '2026-07-22T11:00:00Z'),
      supersedesQualificationId: 'q-1',
    });
    await repository.saveQualification(judgement('q-1', 'lead-1', 'qualified', '2026-07-22T11:00:00Z'));

    const verdicts = await repository.currentVerdicts('bazos');
    expect(verdicts[0].verdict).toBe('disqualified');
  });

  it('prefers the longest chain when two judgements supersede different predecessors', async () => {
    await repository.saveLead(lead('lead-1'));
    await repository.saveQualification(judgement('q-1', 'lead-1', 'qualified', '2026-07-22T11:00:00Z'));
    await repository.saveQualification({
      ...judgement('q-2', 'lead-1', 'qualified', '2026-07-22T12:00:00Z'),
      supersedesQualificationId: 'q-1',
    });
    await repository.saveQualification({
      ...judgement('q-3', 'lead-1', 'disqualified', '2026-07-22T13:00:00Z'),
      supersedesQualificationId: 'q-2',
    });
    // A stray second-generation correction off the same root, decided later by the clock but one
    // correction shallower.
    await repository.saveQualification({
      ...judgement('q-4', 'lead-1', 'qualified', '2026-07-22T14:00:00Z'),
      supersedesQualificationId: 'q-1',
    });

    const verdicts = await repository.currentVerdicts('bazos');
    expect(verdicts[0].verdict).toBe('disqualified');
  });

  // Ids are producer-supplied, so a cycle is reachable by a broken producer. It must answer, and
  // answer the same way twice, rather than recurse until the report endpoint gives up.
  it('still answers when the chain is a cycle', async () => {
    await repository.saveLead(lead('lead-1'));
    await repository.saveQualification({
      ...judgement('q-1', 'lead-1', 'qualified', '2026-07-22T11:00:00Z'),
      supersedesQualificationId: 'q-2',
    });
    await repository.saveQualification({
      ...judgement('q-2', 'lead-1', 'disqualified', '2026-07-22T12:00:00Z'),
      supersedesQualificationId: 'q-1',
    });

    const first = await repository.currentVerdicts('bazos');
    const second = await repository.currentVerdicts('bazos');
    expect(first[0].verdict).toBe('disqualified');
    expect(second).toEqual(first);
  });

  it('scopes verdicts to the workspace', async () => {
    await repository.saveLead(lead('lead-1'));
    await repository.saveLead({ ...lead('lead-2'), workspaceId: 'other' });

    const verdicts = await repository.currentVerdicts('bazos');
    expect(verdicts.map((row) => row.leadId)).toEqual(['lead-1']);
  });

  // The attributed/unattributed split (F-006). Without it a cost-per-registration reading looks
  // worse than reality and invites a wrong kill decision.
  it('marks a lead attributed only when an identity link exists', async () => {
    await repository.saveLead(lead('lead-linked', 'corr-1', 'user-A'));
    await repository.saveLead(lead('lead-unlinked', null, 'user-B'));
    await client.query(
      `INSERT INTO attribution.identity_link (user_id, session_id, correlation_id, workspace_id)
       VALUES ('user-A', 'sess-1', 'corr-1', 'bazos')`,
    );

    const verdicts = await repository.currentVerdicts('bazos');
    const byLead = Object.fromEntries(verdicts.map((row) => [row.leadId, row.attributed]));
    expect(byLead['lead-linked']).toBe(true);
    expect(byLead['lead-unlinked']).toBe(false);
  });
});

describe('the runtime role cannot rewrite a judgement', () => {
  /** Always rolled back, so a regression cannot let the spec destroy what it is checking. */
  const refused = async (sql: string): Promise<Error> => {
    await runtime.query('BEGIN');
    try {
      await runtime.query(sql);
      throw new Error(`expected "${sql.slice(0, 60)}…" to be refused, but it succeeded`);
    } catch (err) {
      return err as Error;
    } finally {
      await runtime.query('ROLLBACK');
    }
  };

  beforeEach(async () => {
    await repository.saveLead(lead('lead-1'));
    await repository.saveQualification(judgement('q-1', 'lead-1', 'qualified', '2026-07-22T11:00:00Z'));
  });

  it('holds no UPDATE grant on lead_qualification', async () => {
    const err = await refused(
      `UPDATE qualification.lead_qualification SET qualification_status = 'disqualified'`,
    );
    expect(err.message).toMatch(/permission denied/i);
  });

  it('holds no DELETE grant on lead_qualification', async () => {
    const err = await refused('DELETE FROM qualification.lead_qualification');
    expect(err.message).toMatch(/permission denied/i);
  });

  // It must still be able to do its actual job.
  it('can read and insert', async () => {
    await expect(
      runtime.query('SELECT count(*) FROM qualification.lead_qualification'),
    ).resolves.toBeDefined();
    await expect(
      runtime.query(
        `INSERT INTO qualification.lead_qualification
           (qualification_id, lead_id, workspace_id, criteria_version, qualification_status,
            decided_by_type, decided_by_id, decided_at, reason)
         VALUES ('q-runtime','lead-1','bazos','v1-owner-manual','qualified','human','admin-7',now(),'ok')`,
      ),
    ).resolves.toBeDefined();
  });

  // A lead's facts come from an event that may legitimately be corrected upstream, so this one
  // does hold UPDATE — asserted so the difference stays deliberate rather than accidental.
  it('can update a lead, which is deliberately not append-only', async () => {
    await expect(
      runtime.query(`UPDATE qualification.lead SET source_service = 'x' WHERE lead_id = 'lead-1'`),
    ).resolves.toBeDefined();
  });
});


/**
 * C-006 §6.6 — the experiment a lead came from, derived rather than stored.
 *
 * Every case here is a shape the old workspace-wide count answered wrongly and silently: it
 * credited one experiment's spend with another's leads, and with leads that never passed a landing
 * page at all.
 */
describe('the experiment a lead came from', () => {
  const click = async (correlationId: string, sessionId: string, initiatedAt: string) => {
    await client.query(
      `INSERT INTO attribution.auth_redirect
         (correlation_id, workspace_id, session_id, gsid_status, initiated_at)
       VALUES ($1,'bazos',$2,'valid',$3)`,
      [correlationId, sessionId, initiatedAt],
    );
  };

  const touchpoint = async (
    id: string,
    sessionId: string,
    experimentId: string,
    occurredAt: string,
  ) => {
    await client.query(
      `INSERT INTO attribution.touchpoint
         (touchpoint_id, session_id, workspace_id, experiment_id, experiment_version,
          landing_version_id, consent_status, occurred_at)
       VALUES ($1,$2,'bazos',$3,'v1','v1-cena','granted',$4)`,
      [id, sessionId, experimentId, occurredAt],
    );
  };

  it('walks lead → click → touchpoint and reports the experiment', async () => {
    await repository.saveLead(lead('lead-1', 'corr-1'));
    await click('corr-1', 'session-1', '2026-07-22T10:00:00.000Z');
    await touchpoint('tp-1', 'session-1', 'exp-001', '2026-07-22T09:59:00.000Z');

    const [row] = await repository.currentVerdicts('bazos');
    expect(row.experimentId).toBe('exp-001');
  });

  it('reports null for a lead that never passed a landing page', async () => {
    // A direct signup. Null is the honest answer; the report counts it separately rather than
    // crediting it to whichever experiment is being looked at.
    await repository.saveLead(lead('lead-1', null));

    const [row] = await repository.currentVerdicts('bazos');
    expect(row.experimentId).toBeNull();
  });

  it('reports null when the click exists but no touchpoint was ever recorded', async () => {
    // Refused consent, a cleared cookie, or a lead that predates the touchpoint table.
    await repository.saveLead(lead('lead-1', 'corr-1'));
    await click('corr-1', 'session-1', '2026-07-22T10:00:00.000Z');

    const [row] = await repository.currentVerdicts('bazos');
    expect(row.experimentId).toBeNull();
  });

  it('keeps two leads on two experiments apart', async () => {
    await repository.saveLead(lead('lead-1', 'corr-1'));
    await click('corr-1', 'session-1', '2026-07-22T10:00:00.000Z');
    await touchpoint('tp-1', 'session-1', 'exp-001', '2026-07-22T09:00:00.000Z');

    await repository.saveLead(lead('lead-2', 'corr-2'));
    await click('corr-2', 'session-2', '2026-08-01T10:00:00.000Z');
    await touchpoint('tp-2', 'session-2', 'exp-002', '2026-08-01T09:00:00.000Z');

    const rows = await repository.currentVerdicts('bazos');
    const byLead = Object.fromEntries(rows.map((r) => [r.leadId, r.experimentId]));
    expect(byLead).toEqual({ 'lead-1': 'exp-001', 'lead-2': 'exp-002' });
  });

  it('uses the view that led to the click, not the session\'s latest view', async () => {
    // The visitor registered under exp-001, then came back weeks later and saw the exp-002
    // landing with the same cookie. Ordering by "latest touchpoint" would move an already
    // registered lead to exp-002 and make the new experiment look like it converted him.
    await repository.saveLead(lead('lead-1', 'corr-1'));
    await click('corr-1', 'session-1', '2026-07-22T10:00:00.000Z');
    await touchpoint('tp-1', 'session-1', 'exp-001', '2026-07-22T09:00:00.000Z');
    await touchpoint('tp-2', 'session-1', 'exp-002', '2026-08-15T09:00:00.000Z');

    const [row] = await repository.currentVerdicts('bazos');
    expect(row.experimentId).toBe('exp-001');
  });

  it('falls back to the nearest later view when nothing precedes the click', async () => {
    // Clock skew between two services, not a later visit: the only recorded view is milliseconds
    // after the click. Answering null there would throw away a lead we can actually place.
    await repository.saveLead(lead('lead-1', 'corr-1'));
    await click('corr-1', 'session-1', '2026-07-22T10:00:00.000Z');
    await touchpoint('tp-late', 'session-1', 'exp-001', '2026-07-22T10:00:00.500Z');
    await touchpoint('tp-later', 'session-1', 'exp-002', '2026-07-22T18:00:00.000Z');

    const [row] = await repository.currentVerdicts('bazos');
    expect(row.experimentId).toBe('exp-001');
  });

  it('does not attribute through a click whose gsid did not verify', async () => {
    // A forged token stores no session id, so there is nothing to join on. The lead stays real
    // and stays uncounted for the experiment — the forgery costs attribution, not the conversion.
    await repository.saveLead(lead('lead-1', 'corr-1'));
    await client.query(
      `INSERT INTO attribution.auth_redirect
         (correlation_id, workspace_id, session_id, gsid_status, initiated_at)
       VALUES ('corr-1','bazos',NULL,'forged','2026-07-22T10:00:00.000Z')`,
    );
    await touchpoint('tp-1', 'session-1', 'exp-001', '2026-07-22T09:00:00.000Z');

    const [row] = await repository.currentVerdicts('bazos');
    expect(row.experimentId).toBeNull();
  });
});
