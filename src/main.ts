import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const config = new DocumentBuilder()
    .setTitle('Alpatrix API')
    .setDescription(
      'Prediction market aggregation and execution layer built on Solana',
    )
    .setVersion('1.0')
    .addTag('markets', 'Market discovery and normalisation')
    .addTag('orders', 'Order placement and lifecycle management')
    .addTag('prices', 'Price feeds and quotes')
    .addTag('execution', 'Order routing and split optimisation')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = process.env.PORT ?? 8000;
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Swagger docs at http://localhost:${port}/api/docs`);
}
bootstrap();
