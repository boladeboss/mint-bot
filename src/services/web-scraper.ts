import { createLogger } from '../core/logger.js';
import type { IChainAdapter, ChainId } from '../types/chains.js';

const log = createLogger('web-scraper');

export interface ScrapedContract {
  address: string;
  chain: ChainId;
  info: any;
}

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch (e) {
    return relative;
  }
}

function extractAddresses(text: string): string[] {
  const matches = text.match(/0x[a-fA-F0-9]{40}/g);
  return matches ? Array.from(new Set(matches)) : [];
}

export async function deepScanUrlForContracts(
  url: string,
  adapters: Map<ChainId, IChainAdapter>
): Promise<ScrapedContract[]> {
  const foundAddresses = new Set<string>();

  try {
    log.info({ url }, 'Fetching main URL');
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.statusText}`);
    }

    const html = await response.text();
    extractAddresses(html).forEach(addr => foundAddresses.add(addr));

    const scriptRegex = /<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi;
    let match;
    const jsUrls: string[] = [];
    
    while ((match = scriptRegex.exec(html)) !== null) {
      if (match[1]) {
        jsUrls.push(resolveUrl(url, match[1]));
      }
    }

    const scriptsToFetch = jsUrls.slice(0, 10);
    
    if (scriptsToFetch.length > 0) {
      log.info({ count: scriptsToFetch.length }, 'Fetching linked JS bundles');
      await Promise.all(
        scriptsToFetch.map(async (scriptUrl) => {
          try {
            const scriptRes = await fetch(scriptUrl, {
               headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (scriptRes.ok) {
              const jsCode = await scriptRes.text();
              extractAddresses(jsCode).forEach(addr => foundAddresses.add(addr));
            }
          } catch (err) {
            // Ignore errors for individual scripts
          }
        })
      );
    }
  } catch (err: any) {
    log.error({ err, url }, 'Failed to scrape URL');
    throw new Error(`Scraping failed: ${err.message}`);
  }

  const uniqueAddresses = Array.from(foundAddresses);
  log.info({ count: uniqueAddresses.length }, 'Found potential addresses in source code');

  if (uniqueAddresses.length === 0) {
    return [];
  }

  const validContracts: ScrapedContract[] = [];
  
  const verifyTasks = uniqueAddresses.map(async (address) => {
    for (const [chain, adapter] of adapters.entries()) {
      if (!adapter.isConnected()) continue;
      try {
        const info = await adapter.getContractInfo(address);
        if (info && info.isValid && (info.mintFunction || info.totalSupply !== undefined || info.name)) {
          validContracts.push({ address, chain, info });
          break;
        }
      } catch (err) {}
    }
  });

  await Promise.all(verifyTasks);

  return validContracts;
}
