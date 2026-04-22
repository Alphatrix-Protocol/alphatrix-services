import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  async generateWalletsForUser(userId: string): Promise<void> {
    // TODO: implement wallet generation
    // Will generate Solana keypair + Polygon wallet,
    // encrypt both with AES-256-GCM using master key from secrets manager,
    // and write solanaAddress, solanaSecretKeyEnc, polygonAddress, polygonPrivKeyEnc to User record.
    // NOT IMPLEMENTED YET — do not add logic here.
    this.logger.log(`Wallet generation pending for user ${userId}`);
  }
}
