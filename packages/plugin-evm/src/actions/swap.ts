import { ChainId, createConfig, executeRoute, getRoutes, ExtendedChain, CallAction, Token, Action } from '@lifi/sdk'
import { WalletProvider } from '../providers/wallet'
import type { Transaction, SwapParams, SupportedChain } from '../types'
import { CHAIN_CONFIGS } from '../providers/wallet'
import { swapTemplate } from '../templates'
import type { ActionExample, IAgentRuntime, Memory, State } from '@ai16z/eliza'

export { swapTemplate }

interface ExtendedAction extends Action {
  approvalAddress?: string
  approvalContract?: {
    encodeApprove: (amount: string) => string
  }
  encodedSwapData: () => string
  fromToken: {
    address: string
  } & Token
  toAddress: string
}

interface ExtendedCallAction extends CallAction {
  approvalAddress?: string
  approvalContract?: {
    encodeApprove: (amount: string) => string
  }
  encodedSwapData: () => string
  fromToken: {
    address: string
  } & Token
  toAddress: string
}

export class SwapAction {
  private config

  constructor(private walletProvider: WalletProvider) {
    this.config = createConfig({
      integrator: 'eliza',
      chains: Object.values(CHAIN_CONFIGS).map(config => ({
        id: config.chainId,
        name: config.name,
        key: config.name.toLowerCase(),
        chainType: 'EVM' as const,
        nativeToken: {
          ...config.nativeCurrency,
          chainId: config.chainId,
          address: '0x0000000000000000000000000000000000000000',
          coinKey: config.nativeCurrency.symbol,
          priceUSD: '0',
          logoURI: '',
          symbol: config.nativeCurrency.symbol,
          decimals: config.nativeCurrency.decimals,
          name: config.nativeCurrency.name
        },
        rpcUrls: {
          public: { http: [config.rpcUrl] }
        },
        blockExplorerUrls: [config.blockExplorerUrl],
        metamask: {
          chainId: `0x${config.chainId.toString(16)}`,
          chainName: config.name,
          nativeCurrency: config.nativeCurrency,
          rpcUrls: [config.rpcUrl],
          blockExplorerUrls: [config.blockExplorerUrl]
        },
        coin: config.nativeCurrency.symbol,
        mainnet: true,
        diamondAddress: '0x0000000000000000000000000000000000000000'
      })) as ExtendedChain[],
    })
  }

  async getTransactionStatus(hash: string, chain: SupportedChain): Promise<'success' | 'failed' | 'pending'> {
    const publicClient = this.walletProvider.getPublicClient(chain)
    const receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` })
    
    if (!receipt) return 'pending'
    return receipt.status === 'success' ? 'success' : 'failed'
  }

  async estimateGas(params: SwapParams): Promise<bigint | null> {
    try {
      const walletClient = this.walletProvider.getWalletClient()
      const [fromAddress] = await walletClient.getAddresses()
      const publicClient = this.walletProvider.getPublicClient(params.chain)

      const routes = await getRoutes({
        fromChainId: CHAIN_CONFIGS[params.chain].chainId as ChainId,
        toChainId: CHAIN_CONFIGS[params.chain].chainId as ChainId,
        fromTokenAddress: params.fromToken,
        toTokenAddress: params.toToken,
        fromAmount: params.amount,
        fromAddress: fromAddress,
        options: {
          slippage: params.slippage || 0.5,
          order: 'RECOMMENDED'
        }
      })

      if (!routes.routes.length) return null

      const route = routes.routes[0]
      const step = route.steps[0]
      const action = step.action as unknown as ExtendedAction | ExtendedCallAction
      
      // Check if token approval is needed
      if (step.tool === 'approval') {
        const gasEstimate = await publicClient.estimateGas({
          account: fromAddress,
          to: action.approvalAddress as `0x${string}`,
          data: action.approvalContract?.encodeApprove(params.amount) as `0x${string}`
        })
        return gasEstimate
      }

      // Estimate the actual swap transaction
      const gasEstimate = await publicClient.estimateGas({
        account: fromAddress,
        to: action.toAddress as `0x${string}`,
        value: BigInt(action.fromToken.address === '0x0000000000000000000000000000000000000000' ? params.amount : '0'),
        data: action.encodedSwapData() as `0x${string}`
      })

      return gasEstimate
    } catch (error) {
      console.error('Error estimating gas:', error)
      return null
    }
  }

  async swap(params: SwapParams): Promise<Transaction> {
    const walletClient = this.walletProvider.getWalletClient()
    const [fromAddress] = await walletClient.getAddresses()

    const routes = await getRoutes({
      fromChainId: CHAIN_CONFIGS[params.chain].chainId as ChainId,
      toChainId: CHAIN_CONFIGS[params.chain].chainId as ChainId,
      fromTokenAddress: params.fromToken,
      toTokenAddress: params.toToken,
      fromAmount: params.amount,
      fromAddress: fromAddress,
      options: {
        slippage: params.slippage || 0.5,
        order: 'RECOMMENDED'
      }
    })

    if (!routes.routes.length) throw new Error('No routes found')
    
    const execution = await executeRoute(routes.routes[0], this.config)
    const process = execution.steps[0]?.execution?.process[0]
    
    if (!process?.status || process.status === 'FAILED') {
      throw new Error('Transaction failed')
    }

    const step = routes.routes[0].steps[0]

    return {
      hash: process.txHash as `0x${string}`,
      from: fromAddress,
      to: step.action.toAddress as `0x${string}`,
      value: BigInt(step.action.fromToken.address === '0x0000000000000000000000000000000000000000' ? params.amount : '0'),
      data: (step.action as unknown as ExtendedAction | ExtendedCallAction).encodedSwapData() as `0x${string}`,
      chainId: CHAIN_CONFIGS[params.chain].chainId
    }
  }
}
export const swapAction = {
  name: "SWAP_TOKENS",
  description: "Swap tokens on the same chain",
  handler: async (runtime: IAgentRuntime, message: Memory, state: State, options: any, callback?: any) => {
    const logger = console;
    logger.debug('[EVM Swap] Starting swap handler');
    
    try {
      const walletProvider = new WalletProvider(runtime);
      const walletStatus = await walletProvider.getWalletStatus();
      
      if (!walletStatus.isConnected) {
        throw new Error('EVM wallet not connected');
      }

      const walletBalance = await walletProvider.getWalletBalance();
      if (!walletBalance || walletBalance === '0') {
        throw new Error('EVM wallet has zero balance');
      }

      // Validate token addresses
      if (!options.fromToken || !options.toToken) {
        logger.error('[EVM Swap] Invalid token addresses');
        throw new Error('Invalid token addresses provided');
      }

      // Set chain based on options or default to base
      const targetChain = options.chain?.toLowerCase() || 'base';
      logger.debug(`[EVM Swap] Target chain: ${targetChain}`);
      
      if (targetChain !== walletProvider.getCurrentChain()) {
        logger.debug(`[EVM Swap] Switching chain from ${walletProvider.getCurrentChain()} to ${targetChain}`);
        await walletProvider.switchChain(targetChain as SupportedChain);
      }

      // Check wallet balance
      const balance = await walletProvider.getWalletBalance();
      if (!balance || balance === '0') {
        throw new Error(`No balance found on ${targetChain}`);
      }

      // Estimate gas before swap
      const action = new SwapAction(walletProvider);
      const gasEstimate = await action.estimateGas(options);
      if (!gasEstimate) {
        throw new Error('Failed to estimate gas');
      }

      // Execute swap with status tracking
      const result = await action.swap(options);
      const txStatus = await action.getTransactionStatus(result.hash, targetChain as SupportedChain);
      
      if (callback) {
        callback({ 
          text: `Swap executed successfully on ${targetChain}. Transaction: ${result.hash}`,
          status: txStatus
        });
      }
      return result;
    } catch (error) {
      logger.error('[EVM Swap] Handler error:', error);
      if (callback) {
        callback({ 
          text: `Swap failed: ${error.message}`,
          error: error.message,
          status: 'error'
        });
      }
      return false;
    }
  },
  validate: async (runtime: IAgentRuntime) => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
    const hasValidKey = typeof privateKey === 'string' && privateKey.startsWith('0x');
    if (!hasValidKey) {
      throw new Error('Invalid or missing EVM private key');
    }
    return hasValidKey;
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          inputToken: "ETH",
          outputToken: "USDC",
          amount: "1",
          chain: "base"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Swapping 1 ETH for USDC on Base...",
          action: "SWAP_TOKENS"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Swap completed successfully! Transaction: 0x123...",
          status: "success"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          inputToken: "USDC",
          outputToken: "ETH",
          amount: "500",
          chain: "ethereum"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Swapping 500 USDC for ETH on Ethereum...",
          action: "SWAP_TOKENS"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Swap failed: Insufficient balance",
          status: "error"
        }
      }
    ]
  ] as ActionExample[][],
  similes: [
    'SWAP_TOKENS',
    'EXCHANGE_TOKENS',
    'TRADE_TOKENS',
    'DEX_SWAP',
    'TOKEN_EXCHANGE',
    'AMM_SWAP',
    'DEX_TRADE',
    'TOKEN_CONVERSION',
    'SWAP_CRYPTO',
    'EXCHANGE_CRYPTO',
    'CONVERT_TOKENS',
    'TRADE_CRYPTO'
  ]
}