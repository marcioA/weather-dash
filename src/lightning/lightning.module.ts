import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LightningStrike } from './entities/lightning-strike.entity';
import { LightningController } from './lightning.controller';
import { LightningService } from './lightning.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([LightningStrike]),
    HttpModule,
  ],
  controllers: [LightningController],
  providers: [LightningService],
})
export class LightningModule {}
