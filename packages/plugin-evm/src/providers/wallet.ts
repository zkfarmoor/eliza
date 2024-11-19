import type { IAgentRuntime, Provider, Memory, State } from "@ai16z/eliza";
import { createPublicClient, createWalletClient, http, formatUnits, type PublicClient, type WalletClient, type Chain, type HttpTransport, type Address, Account } from 'viem'
import { mainnet, base } from 'viem/chains'
import { SupportedChain, ChainConfig, ChainMetadata, WalletStatus, WalletType } from '../types'
import { privateKeyToAccount } from "viem/accounts";

export const CHAIN_CONFIGS: Record<SupportedChain, ChainMetadata> = {
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    chain: mainnet,
    rpcUrl: 'https://eth.llamarpc.com',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    blockExplorerUrl: 'https://etherscan.io'
  },
  base: {
    chainId: 8453,
    name: 'Base',
    chain: base,
    rpcUrl: 'https://base.llamarpc.com',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    blockExplorerUrl: 'https://basescan.org'
  }
} as const;

export class WalletProvider {
  private chainConfigs: Record<SupportedChain, ChainConfig>
  private currentChain: SupportedChain = 'ethereum'
  private address: Address
  private logger: Console

  constructor(private runtime: IAgentRuntime) {
    this.logger = console;
    this.logger.debug('[EVM] Initializing wallet provider');
    
    try {
      const privateKey = runtime.getSetting("EVM_PRIVATE_KEY")
      if (!privateKey) {
        this.logger.warn('[EVM] No private key configured');
        throw new Error("EVM_PRIVATE_KEY not configured")
      }

      const account = privateKeyToAccount(privateKey as `0x${string}`)
      this.address = account.address
      this.logger.debug(`[EVM] Wallet initialized with address: ${this.address}`);

      const createClients = (chain: SupportedChain) => {
        this.logger.debug(`[EVM] Creating clients for chain: ${chain}`);
        return {
          chain: CHAIN_CONFIGS[chain].chain,
          publicClient: createPublicClient({
            chain: CHAIN_CONFIGS[chain].chain,
            transport: http(CHAIN_CONFIGS[chain].rpcUrl)
          }),
          walletClient: createWalletClient({
            chain: CHAIN_CONFIGS[chain].chain,
            transport: http(CHAIN_CONFIGS[chain].rpcUrl),
            account
          })
        }
      }

      this.chainConfigs = {
        ethereum: createClients('ethereum'),
        base: createClients('base')
      }
    } catch (error) {
      this.logger.error('[EVM] Failed to initialize wallet provider:', error);
      throw error;
    }
  }

  async getWalletStatus(): Promise<WalletStatus> {
    try {
      const balance = await this.getWalletBalance();
      return {
        type: WalletType.EVM,
        isConnected: true,
        balance: balance || '0',
        address: this.address,
        chain: this.currentChain
      };
    } catch (error) {
      this.logger.error('[EVM] Error getting wallet status:', error);
      return {
        type: WalletType.EVM,
        isConnected: false,
        balance: '0',
        address: null
      };
    }
  }

  getCurrentChain(): SupportedChain {
    return this.currentChain;
  }

  getAddress(): Address {
    return this.address
  }

  async getWalletBalance(): Promise<string | null> {
    try {
      const client = this.getPublicClient(this.currentChain);
      const walletClient = this.getWalletClient();
      const balance = await client.getBalance({ address: walletClient.account.address });
      return formatUnits(balance, 18);
    } catch (error) {
      console.error('Error getting wallet balance:', error);
      throw error;
    }
  }

  async connect(): Promise<`0x${string}`> {
    return this.runtime.getSetting("EVM_PRIVATE_KEY") as `0x${string}`
  }

  async switchChain(chain: SupportedChain): Promise<void> {
    const walletClient = this.chainConfigs[this.currentChain].walletClient
    if (!walletClient) throw new Error('Wallet not connected')

    try {
      await walletClient.switchChain({ id: CHAIN_CONFIGS[chain].chainId })
    } catch (error: any) {
      if (error.code === 4902) {
        console.log('[WalletProvider] Chain not added to wallet (error 4902) - attempting to add chain first')
        await walletClient.addChain({
          chain: {
            ...CHAIN_CONFIGS[chain].chain,
            rpcUrls: {
              default: { http: [CHAIN_CONFIGS[chain].rpcUrl] },
              public: { http: [CHAIN_CONFIGS[chain].rpcUrl] }
            }
          }
        })
        await walletClient.switchChain({ id: CHAIN_CONFIGS[chain].chainId })
      } else {
        throw error
      }
    }

    this.currentChain = chain
  }

  getPublicClient(chain: SupportedChain): PublicClient<HttpTransport, Chain, Account | undefined> {
    return this.chainConfigs[chain].publicClient;
  }

  getWalletClient(): WalletClient {
    const walletClient = this.chainConfigs[this.currentChain].walletClient
    if (!walletClient) throw new Error('Wallet not connected')
    return walletClient
  }

  getChainConfig(chain: SupportedChain) {
    return CHAIN_CONFIGS[chain]
  }
}

export const evmWalletProvider: Provider = {
  async get(runtime: IAgentRuntime, message: Memory, state?: State): Promise<string | null> {
    try {
      const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
      if (!privateKey?.startsWith('0x')) {
        return "EVM wallet not configured";
      }

      const walletProvider = new WalletProvider(runtime);
      const address = walletProvider.getAddress();
      
      try {
        const balance = await walletProvider.getWalletBalance();
        return `EVM Wallet ${address}\nBalance: ${balance} ETH`;
      } catch (balanceError) {
        console.error('Balance check error:', balanceError);
        return `EVM Wallet ${address}\nError checking balance: ${balanceError.message}`;
      }
    } catch (error) {
      console.error('Error in EVM wallet provider:', error);
      return "EVM wallet error: " + error.message;
    }
  }
}

