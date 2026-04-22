import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/types';
import { Passkey } from '../entities/passkey.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class PasskeyStrategy {
  constructor(
    @InjectRepository(Passkey)
    private readonly passkeyRepo: Repository<Passkey>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  private get rpID() {
    return this.config.get<string>('APP_DOMAIN') ?? 'localhost';
  }

  private get rpName() {
    return 'Alpatrix';
  }

  private get origin() {
    return this.config.get<string>('APP_URL') ?? 'http://localhost:8000';
  }

  private challengeKey(email: string) {
    return `passkey:challenge:${email}`;
  }

  async generateRegistrationOptions(email: string, userId: string) {
    const existingPasskeys = await this.passkeyRepo.find({ where: { userId } });

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userID: new TextEncoder().encode(userId),
      userName: email,
      excludeCredentials: existingPasskeys.map((pk) => ({
        id: pk.credentialId,
        transports: pk.transports as AuthenticatorTransportFuture[],
      })),
    });

    await this.cache.set(this.challengeKey(email), options.challenge, 300000);
    return options;
  }

  async verifyRegistration(
    email: string,
    credential: RegistrationResponseJSON,
  ): Promise<VerifiedRegistrationResponse> {
    const challenge = await this.cache.get<string>(this.challengeKey(email));
    const result = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challenge as string,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
    });
    await this.cache.del(this.challengeKey(email));
    return result;
  }

  async generateAuthenticationOptions(email: string) {
    const user = await this.userRepo.findOne({
      where: { email },
      relations: ['passkeys'],
    });

    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: (user?.passkeys ?? []).map((pk) => ({
        id: pk.credentialId,
        transports: pk.transports as AuthenticatorTransportFuture[],
      })),
    });

    await this.cache.set(this.challengeKey(email), options.challenge, 300000);
    return options;
  }

  async verifyAuthentication(
    email: string,
    credential: AuthenticationResponseJSON,
  ): Promise<{ verified: VerifiedAuthenticationResponse; passkeyId: string }> {
    const challenge = await this.cache.get<string>(this.challengeKey(email));

    const passkey = await this.passkeyRepo.findOne({
      where: { credentialId: credential.id },
    });

    if (!passkey) throw new Error('Passkey not found');

    const result = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challenge as string,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.credentialPublicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports as AuthenticatorTransportFuture[],
      },
    });

    await this.cache.del(this.challengeKey(email));
    return { verified: result, passkeyId: passkey.id };
  }
}
