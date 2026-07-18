import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Complete Profile Schema — new-user / no-match manual identity entry.
 *
 * Collects the identity info required to use the app (Họ tên, Địa chỉ, CCCD),
 * plus an optional mã KH to link an existing Customer 360 record. Used when the
 * event-driven identity resolution did NOT match an existing customer.
 *
 * CCCD is encrypted at rest (AES-256-GCM) by the endpoint via PiiEncryptionService.
 */
export const CompleteProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(255),
  address: z.string().trim().min(5).max(512),
  cccd: z
    .string()
    .trim()
    .regex(/^\d{9}$|^\d{12}$/, 'CCCD phải là 9 hoặc 12 chữ số'),
  maKh: z.string().trim().min(1).max(128).optional(),
});

export type CompleteProfileDto = z.infer<typeof CompleteProfileSchema>;

/** Swagger body DTO (mirrors CompleteProfileSchema for OpenAPI docs). */
export class SwaggerCompleteProfileDto {
  @ApiProperty({ example: 'Nguyễn Văn A', minLength: 2, maxLength: 255 })
  fullName!: string;

  @ApiProperty({
    example: '123 Lê Lợi, Q. Hải Châu, Đà Nẵng',
    minLength: 5,
    maxLength: 512,
  })
  address!: string;

  @ApiProperty({
    example: '012345678901',
    description: 'CCCD 12 số (hoặc CMND 9 số)',
  })
  cccd!: string;

  @ApiPropertyOptional({
    example: 'QN-0912345',
    description: 'Mã khách hàng (tuỳ chọn) — liên kết hồ sơ KH có sẵn',
  })
  maKh?: string;
}
