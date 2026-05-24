import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { firstValueFrom } from 'rxjs';
import { Between, FindManyOptions, Repository } from 'typeorm';
import { BackfillLightningDto } from './dto/backfill-lightning.dto';
import { QueryLightningDto } from './dto/query-lightning.dto';
import { LightningStrike } from './entities/lightning-strike.entity';

const BRAZIL_MONITORING_POINTS = [
  { name: 'São Paulo', lat: -23.5505, lon: -46.6333 },
  { name: 'Rio de Janeiro', lat: -22.9068, lon: -43.1729 },
  { name: 'Belo Horizonte', lat: -19.9167, lon: -43.9345 },
  { name: 'Brasília', lat: -15.7801, lon: -47.9292 },
  { name: 'Salvador', lat: -12.9714, lon: -38.5014 },
  { name: 'Curitiba', lat: -25.4284, lon: -49.2733 },
  { name: 'Manaus', lat: -3.119, lon: -60.0217 },
  { name: 'Belém', lat: -1.4558, lon: -48.4902 },
  { name: 'Goiânia', lat: -16.6869, lon: -49.2648 },
  { name: 'Campo Grande', lat: -20.4697, lon: -54.6201 },
  { name: 'Cuiabá', lat: -15.601, lon: -56.0974 },
  { name: 'Porto Alegre', lat: -30.0346, lon: -51.2177 },
  { name: 'Recife', lat: -8.0539, lon: -34.8811 },
  { name: 'Fortaleza', lat: -3.7172, lon: -38.5433 },
  { name: 'Palmas', lat: -10.2491, lon: -48.3243 },
];

// Intensity in kA for OpenWeatherMap thunderstorm codes
const OWM_INTENSITY_MAP: Record<number, number> = {
  200: 15, 201: 25, 202: 40,
  210: 10, 211: 30, 212: 60, 221: 45,
  230: 12, 231: 20, 232: 35,
};

// Intensity in kA for Open-Meteo WMO thunderstorm codes
const METEO_INTENSITY_MAP: Record<number, number> = {
  95: 25, 96: 40, 99: 60,
};

interface OpenWeatherResponse {
  coord: { lat: number; lon: number };
  weather: Array<{ id: number; main: string; description: string }>;
  dt: number;
  name: string;
}

interface OpenMeteoResponse {
  hourly: {
    time: string[];
    weather_code?: number[];
    weathercode?: number[];
  };
}

@Injectable()
export class LightningService {
  private readonly logger = new Logger(LightningService.name);

  constructor(
    @InjectRepository(LightningStrike)
    private readonly repo: Repository<LightningStrike>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async fetchAndStore(): Promise<{ fetched: number; stored: number }> {
    const apiKey = this.configService.getOrThrow<string>('OPENWEATHER_API_KEY');

    const results = await Promise.allSettled(
      BRAZIL_MONITORING_POINTS.map((point) => this.fetchPointData(point, apiKey)),
    );

    const strikes: Partial<LightningStrike>[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        strikes.push(result.value);
      }
    }

    if (strikes.length > 0) {
      const placeholders = strikes.map(() => '(?,?,?,?,?,?,?)').join(',');
      const params = strikes.flatMap((r) => [
        r.latitude,
        r.longitude,
        r.occurrenceDate,
        r.weatherCode,
        r.intensity,
        r.source,
        r.description,
      ]);
      await this.repo.query(
        `INSERT IGNORE INTO lightning_strikes (latitude, longitude, occurrenceDate, weatherCode, intensity, source, description) VALUES ${placeholders}`,
        params,
      );
    }

    this.logger.log(`Fetch concluído: ${strikes.length}/${BRAZIL_MONITORING_POINTS.length} pontos salvos.`);
    return { fetched: BRAZIL_MONITORING_POINTS.length, stored: strikes.length };
  }

  async backfill(dto: BackfillLightningDto): Promise<{ processed: number; stored: number }> {
    let processed = 0;
    let stored = 0;

    for (const point of BRAZIL_MONITORING_POINTS) {
      try {
        const result = await this.backfillPoint(point, dto.startDate, dto.endDate);
        processed += result.processed;
        stored += result.stored;
        this.logger.log(`${point.name}: ${result.stored} registros salvos.`);
      } catch (err) {
        this.logger.warn(`Backfill falhou para ${point.name}: ${err}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    this.logger.log(`Backfill concluído: ${processed} horas processadas, ${stored} registros salvos.`);
    return { processed, stored };
  }

  private async backfillPoint(
    point: { name: string; lat: number; lon: number },
    startDate: string,
    endDate: string,
  ): Promise<{ processed: number; stored: number }> {
    const url =
      `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${point.lat}&longitude=${point.lon}` +
      `&start_date=${startDate}&end_date=${endDate}` +
      `&hourly=weather_code&timezone=America%2FSao_Paulo`;

    const response = await firstValueFrom(
      this.httpService.get<OpenMeteoResponse>(url),
    );

    const { time } = response.data.hourly;
    const codes = response.data.hourly.weather_code ?? response.data.hourly.weathercode ?? [];

    const records = time.map((t, i) => ({
      latitude: point.lat,
      longitude: point.lon,
      occurrenceDate: new Date(t),
      weatherCode: codes[i] ?? 0,
      intensity: METEO_INTENSITY_MAP[codes[i]] ?? null,
      source: 'Open-Meteo',
      description: point.name,
    }));

    const CHUNK_SIZE = 500;
    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      const chunk = records.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?)').join(',');
      const params = chunk.flatMap((r) => [
        r.latitude,
        r.longitude,
        r.occurrenceDate,
        r.weatherCode,
        r.intensity,
        r.source,
        r.description,
      ]);
      await this.repo.query(
        `INSERT IGNORE INTO lightning_strikes (latitude, longitude, occurrenceDate, weatherCode, intensity, source, description) VALUES ${placeholders}`,
        params,
      );
    }

    return { processed: time.length, stored: records.length };
  }

  private async fetchPointData(
    point: { name: string; lat: number; lon: number },
    apiKey: string,
  ): Promise<Partial<LightningStrike> | null> {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${point.lat}&lon=${point.lon}&appid=${apiKey}&lang=pt_br`;

    const response = await firstValueFrom(
      this.httpService.get<OpenWeatherResponse>(url),
    );

    const data = response.data;
    const condition = data.weather?.[0];

    if (!condition) return null;

    return {
      latitude: data.coord.lat,
      longitude: data.coord.lon,
      occurrenceDate: new Date(data.dt * 1000),
      weatherCode: condition.id,
      intensity: OWM_INTENSITY_MAP[condition.id] ?? null,
      source: 'OpenWeatherMap',
      description: `${point.name}: ${condition.description}`,
    };
  }

  async findAll(query: QueryLightningDto): Promise<LightningStrike[]> {
    const options: FindManyOptions<LightningStrike> = {
      order: { occurrenceDate: 'DESC' },
      take: 1000,
    };

    const where: FindManyOptions<LightningStrike>['where'] = {};

    if (query.startDate && query.endDate) {
      where.occurrenceDate = Between(
        new Date(query.startDate),
        new Date(query.endDate),
      );
    }

    options.where = where;

    let strikes = await this.repo.find(options);

    if (
      query.minLat !== undefined &&
      query.maxLat !== undefined &&
      query.minLon !== undefined &&
      query.maxLon !== undefined
    ) {
      strikes = strikes.filter(
        (s) =>
          Number(s.latitude) >= Number(query.minLat) &&
          Number(s.latitude) <= Number(query.maxLat) &&
          Number(s.longitude) >= Number(query.minLon) &&
          Number(s.longitude) <= Number(query.maxLon),
      );
    }

    return strikes;
  }
}
