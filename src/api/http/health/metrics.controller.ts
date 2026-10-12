import { Controller, Get, Header } from '@nestjs/common';
import { metricsRegistry } from '../../../infrastructure/observability/metrics.js';

@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('content-type', 'text/plain; version=0.0.4')
  public async metrics(): Promise<string> {
    return metricsRegistry.metrics();
  }
}
