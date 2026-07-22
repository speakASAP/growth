import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_GROWTH_CORE_URL = 'http://growth-core.statex-apps.svc.cluster.local:3376';
const TIMEOUT_MS = 2_000;

export type PostJson = (url: string, body: unknown) => Promise<{ status: number }>;

const defaultPost: PostJson = async (url, body) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: response.status };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Sends touchpoints to growth-core's ingest endpoint, which commits them to its durable buffer
 * before acknowledging (C-005 §3).
 *
 * Failures are logged, not thrown. The visitor is looking at a landing page; an ingestion outage
 * must degrade to a missing measurement, never to a page that does not work.
 */
@Injectable()
export class TouchpointEmitter {
  private readonly logger = new Logger(TouchpointEmitter.name);

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly post: PostJson = defaultPost,
  ) {}

  async emit(envelope: unknown): Promise<void> {
    const base = this.config.get<string>('GROWTH_CORE_URL') || DEFAULT_GROWTH_CORE_URL;
    // A bare array: POST /ingest/events takes envelopes directly, not a {"events": [...]} wrapper.
    const { status } = await this.post(`${base}/ingest/events`, [envelope]);

    if (status >= 300) {
      // 400 means the envelope no longer matches the schema — contract drift, which costs every
      // touchpoint until someone notices.
      this.logger.warn(`growth-core rejected a touchpoint (HTTP ${status})`);
    }
  }
}
