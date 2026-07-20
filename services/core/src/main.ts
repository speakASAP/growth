import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // 256 KB: an artefact is free text plus references, never a payload. A body far past this
  // is a mistake, and accepting it would only defer the failure.
  app.useBodyParser('json', { limit: '256kb' });
  const port = Number(process.env.PORT ?? 3376);
  await app.listen(port, '0.0.0.0');
  console.log(`growth-core listening on ${port}`);
}

bootstrap();
