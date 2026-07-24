/**
 * Usage service — lean BFF orchestrator over the meter + meter-reading ports.
 * Thin pass-through to PortRegistry. Methods are the former CQRS handlers'
 * execute() bodies. Two methods retain BFF presentation transformations:
 *   - getCalibrationStatus: derives isWarning from downstream status
 *   - getConsumptionComparison: derives percentageChange + direction
 */
import { Injectable } from '@nestjs/common';
import { PortRegistry } from '@shared/port';
import { PortFallbackException } from '@shared/port/port-exceptions';
import { ValidationException } from '@core/common';
import { MeterIdParamSchema } from './dto/meter.dto';
import { PeriodParamSchema, ComparisonQuerySchema } from './dto/meter-reading.dto';
import type {
  MeterListResponse,
  CalibrationStatusRaw,
  CalibrationStatusResponse,
  MeterHistoryResponse,
} from './dto/meter.dto';
import type {
  ReadingsListResponse,
  ComparisonRaw,
  ComparisonResponse,
  ReadingDetail,
} from './dto/meter-reading.dto';
import type { RealtimeConsumption, SmartMeterStatus } from './dto/smart-meter.dto';

@Injectable()
export class UsageService {
  constructor(private readonly portRegistry: PortRegistry) {}

  async getMeters(customerId: string): Promise<MeterListResponse> {
    const result = await this.portRegistry.execute<MeterListResponse>(
      'meter',
      'get-meter-by-customer',
      { customerId },
    );
    return result.data;
  }

  async getCalibrationStatus(
    customerId: string,
    meterId: string,
  ): Promise<CalibrationStatusResponse> {
    this.validateMeterId(meterId);
    const result = await this.portRegistry.execute<CalibrationStatusRaw>(
      'meter',
      'get-calibration-status',
      { customerId, meterId },
    );
    const raw = result.data;
    // BFF presentation logic: derive isWarning for frontend badge
    const isWarning = raw.status === 'expiring_soon' || raw.status === 'expired';
    return { ...raw, isWarning };
  }

  async getMeterHistory(
    customerId: string,
    meterId: string,
  ): Promise<MeterHistoryResponse> {
    this.validateMeterId(meterId);
    const result = await this.portRegistry.execute<MeterHistoryResponse>(
      'meter',
      'get-meter-history',
      { customerId, meterId },
    );
    return result.data;
  }

  async getConsumptionHistory(customerId: string): Promise<ReadingsListResponse> {
    const result = await this.portRegistry.execute<ReadingsListResponse>(
      'meter-reading',
      'get-readings',
      { customerId },
    );
    return result.data;
  }

  async getConsumptionComparison(
    customerId: string,
    currentPeriod: string,
    previousPeriod: string,
  ): Promise<ComparisonResponse> {
    this.validateComparisonParams(currentPeriod, previousPeriod);
    const result = await this.portRegistry.execute<ComparisonRaw>(
      'meter-reading',
      'get-comparison',
      { customerId, currentPeriod, previousPeriod },
    );
    // BFF presentation logic: compute percentage change + direction
    // Edge case: previousVolume === 0 → percentageChange = null, direction = 'neutral'
    const { currentVolume, previousVolume } = result.data;
    const percentageChange = previousVolume === 0
      ? null // can't divide by zero
      : Math.round(((currentVolume - previousVolume) / previousVolume * 100) * 100) / 100;

    const direction: 'up' | 'down' | 'neutral' =
      percentageChange === null ? 'neutral'
      : percentageChange > 0 ? 'up'
      : percentageChange < 0 ? 'down'
      : 'neutral';

    return {
      ...result.data,
      percentageChange,
      direction,
    };
  }

  async getReadingDetail(customerId: string, period: string): Promise<ReadingDetail> {
    this.validatePeriod(period);
    const result = await this.portRegistry.execute<ReadingDetail>(
      'meter-reading',
      'get-reading-detail',
      { customerId, period },
    );
    return result.data;
  }

  // ── smart-meter port (folded from former smart-meter module) ───────────────

  async getRealtimeConsumption(customerId: string): Promise<RealtimeConsumption> {
    const r = await this.portRegistry.execute<RealtimeConsumption>(
      'smart-meter',
      'get-realtime-consumption',
      { customerId },
    );
    if (!r?.data) throw new PortFallbackException('smart-meter');
    return r.data;
  }

  async getMeterStatus(meterId: string): Promise<SmartMeterStatus> {
    const r = await this.portRegistry.execute<SmartMeterStatus>(
      'smart-meter',
      'get-meter-status',
      { meterId },
    );
    if (!r?.data) throw new PortFallbackException('smart-meter');
    return r.data;
  }

  /** Validate meterId param — alphanumeric, dashes, underscores (IoT/device IDs). */
  private validateMeterId(meterId: string): void {
    const parsed = MeterIdParamSchema.safeParse(meterId);
    if (!parsed.success) {
      throw new ValidationException('Invalid meter ID format');
    }
  }

  /** Validate period param — YYYY-MM format. */
  private validatePeriod(period: string): void {
    const parsed = PeriodParamSchema.safeParse(period);
    if (!parsed.success) {
      throw new ValidationException('Invalid period format. Use YYYY-MM');
    }
  }

  /** Validate comparison query params — both must be YYYY-MM. */
  private validateComparisonParams(current: string, previous: string): void {
    const parsed = ComparisonQuerySchema.safeParse({ current, previous });
    if (!parsed.success) {
      throw new ValidationException(
        'Invalid period parameters. Use YYYY-MM format for both current and previous',
      );
    }
  }
}
