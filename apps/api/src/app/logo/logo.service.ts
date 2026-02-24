import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { SymbolProfileService } from '@ghostfolio/api/services/symbol-profile/symbol-profile.service';
import { AssetProfileIdentifier } from '@ghostfolio/common/interfaces';

import { Injectable } from '@nestjs/common';
import { DataSource } from '@prisma/client';

/** 1x1 transparent PNG so missing-logo requests return 200 and avoid console 404s. */
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

@Injectable()
export class LogoService {
  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly symbolProfileService: SymbolProfileService
  ) {}

  public async getLogoByDataSourceAndSymbol({
    dataSource,
    symbol
  }: AssetProfileIdentifier): Promise<{ buffer: Buffer; type: string }> {
    if (!DataSource[dataSource]) {
      return this.getPlaceholder();
    }

    const [assetProfile] = await this.symbolProfileService.getSymbolProfiles([
      { dataSource, symbol }
    ]);

    if (!assetProfile?.url) {
      return this.getPlaceholder();
    }

    try {
      return await this.getBuffer(assetProfile.url);
    } catch {
      return this.getPlaceholder();
    }
  }

  public async getLogoByUrl(aUrl: string): Promise<{ buffer: Buffer; type: string }> {
    try {
      return await this.getBuffer(aUrl);
    } catch {
      return this.getPlaceholder();
    }
  }

  private getPlaceholder(): { buffer: Buffer; type: string } {
    return {
      buffer: TRANSPARENT_PNG,
      type: 'image/png'
    };
  }

  private async getBuffer(aUrl: string) {
    const blob = await fetch(
      `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${aUrl}&size=64`,
      {
        headers: { 'User-Agent': 'request' },
        signal: AbortSignal.timeout(
          this.configurationService.get('REQUEST_TIMEOUT')
        )
      }
    ).then((res) => res.blob());

    return {
      buffer: await blob.arrayBuffer().then((arrayBuffer) => {
        return Buffer.from(arrayBuffer);
      }),
      type: blob.type
    };
  }
}
