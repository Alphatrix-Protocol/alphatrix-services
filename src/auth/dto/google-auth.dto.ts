import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({ description: 'Google id_token from the frontend OAuth flow' })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
