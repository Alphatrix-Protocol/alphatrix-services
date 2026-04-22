import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsObject, IsString } from 'class-validator';

export class PasskeyRegisterOptionsDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;
}

export class PasskeyRegisterVerifyDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'RegistrationResponseJSON from WebAuthn API' })
  @IsObject()
  credential: Record<string, unknown>;
}

export class PasskeyLoginOptionsDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;
}

export class PasskeyLoginVerifyDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'AuthenticationResponseJSON from WebAuthn API' })
  @IsObject()
  credential: Record<string, unknown>;
}

export class UserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ required: false })
  name?: string;

  @ApiProperty({ required: false })
  avatarUrl?: string;

  @ApiProperty({ required: false, description: 'Solana wallet address' })
  solanaAddress?: string;

  @ApiProperty({
    required: false,
    description: 'USDC token account address — send USDC here',
  })
  usdcTokenAddress?: string;
}

export class AuthResponseDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  accessToken: string;

  @ApiProperty({ type: UserDto })
  user: UserDto;
}
