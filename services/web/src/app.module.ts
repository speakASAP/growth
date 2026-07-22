import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LandingModule } from './landing/landing.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), LandingModule],
})
export class AppModule {}
