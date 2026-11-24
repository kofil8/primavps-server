import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './../src/common/interceptors/logging.interceptor';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply same global configuration as main.ts
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'v',
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(
      new LoggingInterceptor(),
      new TransformInterceptor(),
    );
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();
  });

  it('GET /api/v1 returns welcome message wrapped in standard response', () => {
    return request(app.getHttpServer() as App)
      .get('/api/v1')
      .expect(200)
      .expect((res) => {
        const body = res.body as {
          success: boolean;
          statusCode: number;
          message: string;
          data: string;
        };
        expect(body.success).toBe(true);
        expect(body.statusCode).toBe(200);
        expect(body.message).toBe('Data fetched successfully');
        expect(body.data).toContain('Welcome to');
      });
  });

  it('GET / returns 404 (no route without prefix)', () => {
    return request(app.getHttpServer() as App)
      .get('/')
      .expect(404);
  });

  afterAll(async () => {
    await app.close();
  });
});
