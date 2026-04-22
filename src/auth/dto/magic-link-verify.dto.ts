import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class MagicLinkVerifyDto {
  @ApiProperty({ description: 'One-time token from the magic link email' })
  @IsString()
  @IsNotEmpty()
  token: string;
}
