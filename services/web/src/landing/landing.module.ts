import { Module } from '@nestjs/common';
import { LandingController } from './landing.controller';
import { TouchpointEmitter } from './touchpoint.emitter';

@Module({
  controllers: [LandingController],
  providers: [TouchpointEmitter],
})
export class LandingModule {}
