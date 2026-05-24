import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LightningStrike } from './lightning/entities/lightning-strike.entity';
import { LightningModule } from './lightning/lightning.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get<string>('NODE_ENV') === 'production';
        return {
          type: 'mysql',
          host: config.get<string>('DB_HOST', 'localhost'),
          port: config.get<number>('DB_PORT', 3306),
          username: config.get<string>('DB_USER', 'root'),
          password: config.get<string>('DB_PASS', ''),
          database: config.get<string>('DB_NAME', 'weather_dash'),
          entities: [LightningStrike],
          synchronize: !isProduction,
          extra: {
            // Small pool for serverless — avoids exhausting MySQL max_connections
            connectionLimit: isProduction ? 5 : 10,
            connectTimeout: 10000,
          },
        };
      },
    }),
    LightningModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
