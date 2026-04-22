import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { GoogleAuthDto } from './dto/google-auth.dto';
import {
  PasskeyRegisterOptionsDto,
  PasskeyRegisterVerifyDto,
  PasskeyLoginOptionsDto,
  PasskeyLoginVerifyDto,
  AuthResponseDto,
  UserDto,
} from './dto/passkey-verify.dto';
import { MagicLinkSendDto } from './dto/magic-link-send.dto';
import { MagicLinkVerifyDto } from './dto/magic-link-verify.dto';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ─── Google ──────────────────────────────────────────────────────────────

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with Google id_token' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  googleAuth(@Body() dto: GoogleAuthDto) {
    return this.authService.googleAuth(dto.idToken);
  }

  // ─── Passkey ─────────────────────────────────────────────────────────────

  @Post('passkey/register/options')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get passkey registration challenge' })
  passkeyRegisterOptions(@Body() dto: PasskeyRegisterOptionsDto) {
    return this.authService.passkeyRegisterOptions(dto.email);
  }

  @Post('passkey/register/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify passkey registration and issue JWT' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  passkeyRegisterVerify(@Body() dto: PasskeyRegisterVerifyDto) {
    return this.authService.passkeyRegisterVerify(
      dto.email,
      dto.credential as unknown as RegistrationResponseJSON,
    );
  }

  @Post('passkey/login/options')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get passkey authentication challenge' })
  passkeyLoginOptions(@Body() dto: PasskeyLoginOptionsDto) {
    return this.authService.passkeyLoginOptions(dto.email);
  }

  @Post('passkey/login/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify passkey authentication and issue JWT' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  passkeyLoginVerify(@Body() dto: PasskeyLoginVerifyDto) {
    return this.authService.passkeyLoginVerify(
      dto.email,
      dto.credential as unknown as AuthenticationResponseJSON,
    );
  }

  // ─── Magic link ──────────────────────────────────────────────────────────

  @Post('magic-link/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a magic link to the given email' })
  magicLinkSend(@Body() dto: MagicLinkSendDto) {
    return this.authService.magicLinkSend(dto.email);
  }

  @Post('magic-link/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a magic link token and issue JWT' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  magicLinkVerify(@Body() dto: MagicLinkVerifyDto) {
    return this.authService.magicLinkVerify(dto.token);
  }

  // ─── Me ──────────────────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @ApiResponse({ status: 200, type: UserDto })
  getMe(@CurrentUser() user: JwtPayload) {
    return this.authService.getMe(user.sub);
  }
}
