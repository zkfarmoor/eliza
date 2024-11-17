import type { Plugin } from '@ai16z/eliza'
import { WalletProvider } from './providers/wallet'
import { TransferAction } from './actions/transfer'
import { BridgeAction } from './actions/bridge'
import { SwapAction } from './actions/swap'
import type { EvmPluginConfig } from './types'

export class EvmPlugin implements Plugin {
  public name = 'evm'
  public description = 'EVM blockchain integration plugin'
  private walletProvider: WalletProvider
  private transferAction: TransferAction
  private bridgeAction: BridgeAction
  private swapAction: SwapAction

  constructor(config?: EvmPluginConfig) {
    this.walletProvider = new WalletProvider(config?.rpcUrl)
    this.transferAction = new TransferAction(this.walletProvider)
    this.bridgeAction = new BridgeAction(this.walletProvider)
    this.swapAction = new SwapAction(this.walletProvider)
  }

  async connect(): Promise<string> {
    return await this.walletProvider.connect()
  }

  async getBalance(address: `0x${string}`, chain: 'ethereum' | 'base' = 'ethereum'): Promise<bigint> {
    const client = this.walletProvider.getPublicClient(chain)
    return await client.getBalance({ address })
  }

  async getBlockNumber(chain: 'ethereum' | 'base' = 'ethereum'): Promise<bigint> {
    const client = this.walletProvider.getPublicClient(chain)
    return await client.getBlockNumber()
  }

  async switchChain(chain: 'ethereum' | 'base'): Promise<void> {
    await this.walletProvider.switchChain(chain)
  }

  async transfer(params: {
    fromChain: 'ethereum' | 'base'
    toAddress: `0x${string}`
    amount: bigint
  }) {
    return await this.transferAction.transfer({
      fromChain: params.fromChain,
      toAddress: params.toAddress,
      amount: params.amount.toString(),
    })
  }

  async bridge(params: {
    fromChain: 'ethereum' | 'base'
    toChain: 'ethereum' | 'base'
    fromToken: `0x${string}`
    toToken: `0x${string}`
    amount: string
    toAddress: `0x${string}`
  }) {
    return await this.bridgeAction.bridge(params)
  }

  async swap(params: {
    chain: 'ethereum' | 'base'
    fromToken: `0x${string}`
    toToken: `0x${string}`
    amount: string
  }) {
    return await this.swapAction.swap(params)
  }
}

export default EvmPlugin
