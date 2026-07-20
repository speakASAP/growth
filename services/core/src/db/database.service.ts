import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool!: Pool;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const connectionString = this.config.get<string>('DATABASE_URL');
    this.pool = new Pool(
      connectionString
        ? { connectionString }
        : {
            host: this.config.get<string>('DB_HOST'),
            port: Number(this.config.get<string>('DB_PORT') ?? 5432),
            user: this.config.get<string>('DB_USER'),
            password: this.config.get<string>('DB_PASSWORD'),
            database: this.config.get<string>('DB_NAME'),
          },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, params);
  }

  /**
   * Runs `work` on a single dedicated connection inside a transaction.
   *
   * The ingest worker needs this rather than the pool: `FOR UPDATE SKIP LOCKED` holds its row
   * locks until the transaction ends, and the pool hands out an arbitrary connection per call,
   * so the claim and the status update would land on different sessions and the locks would be
   * released before the work they were guarding had happened.
   */
  async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Used by the health probe: a pool that cannot round-trip is not healthy. */
  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
