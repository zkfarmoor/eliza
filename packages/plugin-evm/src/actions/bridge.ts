import { ChainId, createConfig, executeRoute, getRoutes, ExtendedChain, CallAction, Token, Action } from '@lifi/sdk'
import { WalletProvider } from '../providers/wallet'
import type { Transaction, BridgeParams, SupportedChain } from '../types'
import { CHAIN_CONFIGS } from '../providers/wallet'
import { bridgeTemplate } from '../templates'
import type { ActionExample, IAgentRuntime, Memory, State } from '@ai16z/eliza'

export { bridgeTemplate }

interface ExtendedBridgeAction extends Action {
  approvalAddress?: string
  approvalContract?: {
    encodeApprove: (amount: string) => string
  }
  encodedBridgeData?: () => string
  fromToken: {
    address: string
  } & Token
  toAddress: string
}

interface ExtendedBridgeCallAction extends CallAction {
  approvalAddress?: string
  approvalContract?: {
    encodeApprove: (amount: string) => string
  }
  encodedBridgeData?: () => string
  fromToken: {
    address: string
  } & Token
  toAddress: string
}

export class BridgeAction {
  private config

  constructor(private walletProvider: WalletProvider) {
    this.config = createConfig({
      integrator: 'eliza',
      chains: Object.values(CHAIN_CONFIGS).map(config => ({
        id: config.chainId,
        name: config.name,
        key: config.name.toLowerCase(),
        chainType: 'EVM',
        nativeToken: {
          ...config.nativeCurrency,
          chainId: config.chainId,
          address: '0x0000000000000000000000000000000000000000',
          coinKey: config.nativeCurrency.symbol,
        },
        metamask: {
          chainId: `0x${config.chainId.toString(16)}`,
          chainName: config.name,
          nativeCurrency: config.nativeCurrency,
          rpcUrls: [config.rpcUrl],
          blockExplorerUrls: [config.blockExplorerUrl]
        },
        diamondAddress: '0x0000000000000000000000000000000000000000',
        coin: config.nativeCurrency.symbol,
        mainnet: true
      })) as ExtendedChain[]
    })
  }

  async bridge(params: BridgeParams): Promise<Transaction> {
    const walletClient = this.walletProvider.getWalletClient()
    const [fromAddress] = await walletClient.getAddresses()

    const routes = await getRoutes({
      fromChainId: CHAIN_CONFIGS[params.fromChain].chainId as ChainId,
      toChainId: CHAIN_CONFIGS[params.toChain].chainId as ChainId,
      fromTokenAddress: params.fromToken,
      toTokenAddress: params.toToken,
      fromAmount: params.amount,
      fromAddress: fromAddress,
      toAddress: params.toAddress || fromAddress
    })

    if (!routes.routes.length) throw new Error('No routes found')

    const execution = await executeRoute(routes.routes[0], this.config)
    const process = execution.steps[0]?.execution?.process[0]
    
    if (!process?.status || process.status === 'FAILED') {
      throw new Error('Transaction failed')
    }

    const action = routes.routes[0].steps[0].action as unknown as ExtendedBridgeAction | ExtendedBridgeCallAction

    return {
      hash: process.txHash as `0x${string}`,
      from: fromAddress,
      to: action.approvalAddress as `0x${string}`,
      value: BigInt(params.amount),
      chainId: CHAIN_CONFIGS[params.fromChain].chainId
    }
  }

  async getTransactionStatus(hash: string, chain: SupportedChain): Promise<'success' | 'failed' | 'pending'> {
    const publicClient = this.walletProvider.getPublicClient(chain)
    const receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` })
    
    if (!receipt) return 'pending'
    return receipt.status === 'success' ? 'success' : 'failed'
  }

  async estimateGas(params: BridgeParams): Promise<bigint | null> {
    try {
      const walletClient = this.walletProvider.getWalletClient()
      const [fromAddress] = await walletClient.getAddresses()
      const publicClient = this.walletProvider.getPublicClient(params.fromChain)

      const routes = await getRoutes({
        fromChainId: CHAIN_CONFIGS[params.fromChain].chainId as ChainId,
        toChainId: CHAIN_CONFIGS[params.toChain].chainId as ChainId,
        fromTokenAddress: params.fromToken,
        toTokenAddress: params.toToken,
        fromAmount: params.amount,
        fromAddress: fromAddress,
        toAddress: params.toAddress || fromAddress
      })

      if (!routes.routes.length) return null

      const route = routes.routes[0]
      const step = route.steps[0]
      const action = step.action as unknown as ExtendedBridgeAction | ExtendedBridgeCallAction

      if (step.tool === 'approval') {
        const gasEstimate = await publicClient.estimateGas({
          account: fromAddress,
          to: action.approvalAddress as `0x${string}`,
          data: action.approvalContract?.encodeApprove(params.amount) as `0x${string}`
        })
        return gasEstimate
      }

      const gasEstimate = await publicClient.estimateGas({
        account: fromAddress,
        to: action.toAddress as `0x${string}`,
        value: BigInt(action.fromToken.address === '0x0000000000000000000000000000000000000000' ? params.amount : '0'),
        data: action.encodedBridgeData?.() as `0x${string}`
      })

      return gasEstimate
    } catch (error) {
      console.error('Error estimating gas:', error)
      return null
    }
  }
}

export const bridgeAction = {
  name: 'bridge',
  description: 'Bridge tokens between different chains',
  handler: async (runtime: IAgentRuntime, message: Memory, state: State, options: any) => {
    const walletProvider = new WalletProvider(runtime)
    const action = new BridgeAction(walletProvider)
    return action.bridge(options)
  },
  template: bridgeTemplate,
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
          fromChain: "ethereum",
          toChain: "base",
          amount: "1",
          token: "ETH"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Bridging 1 ETH from Ethereum to Base...",
          action: "CROSS_CHAIN_TRANSFER"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Bridge completed successfully! Transaction: 0x123...",
          status: "success"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          fromChain: "base",
          toChain: "optimism",
          amount: "500",
          token: "USDC"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Bridge failed: No routes available",
          status: "error"
        }
      }
    ]
  ] as ActionExample[][],
  similes: [
    'CROSS_CHAIN_TRANSFER',
    'CHAIN_BRIDGE',
    'MOVE_CROSS_CHAIN',
    'BRIDGE_TOKENS',
    'CROSS_CHAIN_BRIDGE',
    'CHAIN_HOP',
    'L2_BRIDGE'
  ]
}