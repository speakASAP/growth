import { Module } from '@nestjs/common';
import { DecisionController } from './decision.controller';
import { DecisionService } from './decision.service';
import { DecisionRepository } from './decision.repository';

@Module({
  controllers: [DecisionController],
  providers: [DecisionService, DecisionRepository],
  exports: [DecisionService],
})
export class GovernanceModule {}
