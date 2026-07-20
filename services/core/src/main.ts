import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Without this, SIGTERM from Kubernetes kills the process outright: the drain interval is never
  // cleared and the broker connection never closed, so a rolling deploy can tear down a pod
  // mid-publish instead of letting it finish.
  app.enableShutdownHooks();
  // 256 KB: an artefact is free text plus references, never a payload. A body far past this
  // is a mistake, and accepting it would only defer the failure.
  app.useBodyParser('json', { limit: '256kb' });
  const port = Number(process.env.PORT ?? 3376);
  await app.listen(port, '0.0.0.0');
  console.log(`growth-core listening on ${port}`);
}

bootstrap();
