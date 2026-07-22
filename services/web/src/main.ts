import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  // The only body this service accepts is a consent decision. Anything larger is a mistake.
  app.useBodyParser('json', { limit: '32kb' });
  const port = Number(process.env.PORT ?? 3377);
  await app.listen(port, '0.0.0.0');
  console.log(`growth-web listening on ${port}`);
}

bootstrap();
