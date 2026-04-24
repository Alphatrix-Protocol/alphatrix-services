import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { User } from '../auth/entities/user.entity';
import { encryptSecretKey, decryptSecretKey } from './wallet-crypto';

// USDC mint address on Solana mainnet
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
// USDC has 6 decimal places
const USDC_DECIMALS = 1_000_000;

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly connection: Connection;
  private readonly masterKey: Buffer;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    this.connection = new Connection(
      config.get<string>('SOLANA_RPC_URL') ??
        'https://api.mainnet-beta.solana.com',
      'confirmed',
    );

    const hexKey = config.get<string>('WALLET_ENCRYPTION_KEY');
    if (!hexKey || hexKey.length !== 64) {
      throw new InternalServerErrorException(
        'WALLET_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)',
      );
    }
    this.masterKey = Buffer.from(hexKey, 'hex');
  }

  // ─── Generate ────────────────────────────────────────────────────────────

  async generateWalletsForUser(
    userId: string,
  ): Promise<{ solanaAddress: string; usdcTokenAddress: string } | null> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      this.logger.warn(`generateWalletsForUser: user ${userId} not found`);
      return null;
    }

    if (user.solanaAddress && user.usdcTokenAddress) {
      this.logger.log(`Wallets already exist for user ${userId}, skipping`);
      return {
        solanaAddress: user.solanaAddress,
        usdcTokenAddress: user.usdcTokenAddress,
      };
    }

    const keypair = Keypair.generate();
    const solanaAddress = keypair.publicKey.toBase58();
    const solanaSecretKeyEnc = encryptSecretKey(
      keypair.secretKey,
      this.masterKey,
      user.id,
      user.email,
    );

    // Derive USDC ATA address — pure math, no network call
    const usdcTokenAddress = getAssociatedTokenAddressSync(
      USDC_MINT,
      keypair.publicKey,
    ).toBase58();

    await this.userRepo.update(userId, {
      solanaAddress,
      solanaSecretKeyEnc,
      usdcTokenAddress,
      walletsGeneratedAt: new Date(),
    });

    this.logger.log(
      `Wallet generated for user ${userId} — address: ${solanaAddress} | USDC ATA: ${usdcTokenAddress}`,
    );
    return { solanaAddress, usdcTokenAddress };
  }

  // ─── Balance ─────────────────────────────────────────────────────────────

  async getSolBalance(userId: string): Promise<number> {
    const user = await this.resolveUser(userId);
    const pubkey = new PublicKey(user.solanaAddress);
    const lamports = await this.connection.getBalance(pubkey);
    return lamports / LAMPORTS_PER_SOL;
  }

  async getUsdcBalance(userId: string): Promise<number> {
    const user = await this.resolveUser(userId);
    const walletPubkey = new PublicKey(user.solanaAddress);

    try {
      const ata = await this.connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        {
          mint: USDC_MINT,
        },
      );

      if (ata.value.length === 0) return 0;

      const parsed = ata.value[0].account.data.parsed as {
        info: { tokenAmount: { uiAmount: number | null } };
      };
      return parsed.info.tokenAmount.uiAmount ?? 0;
    } catch {
      return 0;
    }
  }

  // ─── Transfer ────────────────────────────────────────────────────────────

  async transferUsdc(
    fromUserId: string,
    toAddress: string,
    amount: number,
  ): Promise<string> {
    const user = await this.resolveUser(fromUserId);
    const secretKey = decryptSecretKey(
      user.solanaSecretKeyEnc,
      this.masterKey,
      user.id,
      user.email,
    );

    const senderKeypair = Keypair.fromSecretKey(secretKey);
    const recipientPubkey = new PublicKey(toAddress);

    // Get or create sender ATA
    const senderAta = await getOrCreateAssociatedTokenAccount(
      this.connection,
      senderKeypair, // payer for account creation
      USDC_MINT,
      senderKeypair.publicKey,
    );

    // Get or create recipient ATA (sender pays creation fee if new)
    const recipientAta = await getOrCreateAssociatedTokenAccount(
      this.connection,
      senderKeypair,
      USDC_MINT,
      recipientPubkey,
    );

    const { transfer } = await import('@solana/spl-token');
    const sig = await transfer(
      this.connection,
      senderKeypair,
      senderAta.address,
      recipientAta.address,
      senderKeypair,
      BigInt(Math.round(amount * USDC_DECIMALS)),
    );

    this.logger.log(
      `USDC transfer: ${amount} from ${user.solanaAddress} to ${toAddress} — tx: ${sig}`,
    );
    return sig;
  }

  // ─── Address lookup ──────────────────────────────────────────────────────

  async getWalletAddress(userId: string): Promise<string> {
    const user = await this.resolveUser(userId);
    return user.solanaAddress;
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private async resolveUser(
    userId: string,
  ): Promise<User & { solanaAddress: string; solanaSecretKeyEnc: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user?.solanaAddress || !user?.solanaSecretKeyEnc) {
      throw new InternalServerErrorException(
        `Wallet not found for user ${userId}`,
      );
    }
    return user;
  }
}
