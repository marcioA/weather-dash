import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { INestApplication } from '@nestjs/common';
import express, { Express, Request, Response } from 'express';
import { AppModule } from '../src/app.module';

const expressInstance: Express = express();
let app: INestApplication;

async function bootstrap(): Promise<void> {
  if (app) return;
  app = await NestFactory.create(AppModule, new ExpressAdapter(expressInstance), {
    logger: ['error', 'warn'],
  });
  app.enableCors();
  await app.init();
}

export default async function handler(req: Request, res: Response): Promise<void> {
  await bootstrap();
  expressInstance(req, res);
}
