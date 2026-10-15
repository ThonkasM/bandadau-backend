import type { PublicSigningKey, QrSigner } from '../ports/qr-signer';

export class GetSigningKeysUseCase {
  constructor(private readonly signer: QrSigner) {}

  execute(): { keys: PublicSigningKey[] } {
    return { keys: this.signer.publicKeys() };
  }
}
