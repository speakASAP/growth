import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';

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
