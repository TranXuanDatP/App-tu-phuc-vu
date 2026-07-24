import { z } from 'zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Register Schema — new-customer signup via the app (replaces complete-profile).
 *
 * Collects the FULL info needed to create a Customer 360 record: identity (Họ tên,
 * CCCD), classification, and a structured address. The endpoint creates a customer
 * (mock-first via the customer-profile port) and links it to the auth user.
 *
 * This is the "đăng ký dịch vụ nước" path for a brand-new user with no existing
 * Customer 360 record — distinct from linking an existing mã KH. CCCD is encrypted
 * at rest (AES-256-GCM) by the endpoint via PiiEncryptionService.
 */
export const RegisterSchema = z.object({
  fullName: z.string().trim().min(2).max(255),
  cccd: z
    .string()
    .trim()
    .regex(/^\d{9}$|^\d{12}$/, 'CCCD phải là 9 hoặc 12 chữ số'),
  classification: z.enum(['sinh_hoat', 'san_xuat', 'hanh_chinh']),
  address: z.object({
    street: z.string().trim().min(1).max(256),
    ward: z.string().trim().min(1).max(128),
    district: z.string().trim().min(1).max(128),
    city: z.string().trim().min(1).max(128),
  }),
  email: z.string().trim().email().optional(),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;

/** Swagger body DTO (mirrors RegisterSchema for OpenAPI docs). */
export class SwaggerRegisterDto {
  @ApiProperty({ example: 'Nguyễn Văn A', minLength: 2, maxLength: 255 })
  fullName!: string;

  @ApiProperty({ example: '012345678901', description: 'CCCD 12 số (hoặc CMND 9 số)' })
  cccd!: string;

  @ApiProperty({
    enum: ['sinh_hoat', 'san_xuat', 'hanh_chinh'],
    example: 'sinh_hoat',
    description: 'Phân loại khách hàng',
  })
  classification!: 'sinh_hoat' | 'san_xuat' | 'hanh_chinh';

  @ApiProperty({
    description: 'Địa chỉ cấu trúc (Customer 360 yêu cầu)',
    example: { street: '123 Lê Lợi', ward: 'Phường Hải Châu 1', district: 'Quận Hải Châu', city: 'Đà Nẵng' },
  })
  address!: {
    street: string;
    ward: string;
    district: string;
    city: string;
  };

  @ApiPropertyOptional({ example: 'nguyenvana@email.com' })
  email?: string;
}
