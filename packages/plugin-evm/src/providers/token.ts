import { type PublicClient, formatUnits } from 'viem'
import type { Token } from '@lifi/types'
import { CHAIN_CONFIGS } from './wallet'
import type { WalletProvider } from './wallet'

export class TokenProvider {
  private publicClients: Record<string, PublicClient>

  constructor(walletProvider: WalletProvider) {
    this.publicClients = {
      ethereum: walletProvider.getPublicClient('ethereum'),
      base: walletProvider.getPublicClient('base')
    }
  }

  async getTokenBalance(params: {
    chain: 'ethereum' | 'base'
    tokenAddress: string
    walletAddress: string
  }): Promise<bigint> {
    const client = this.publicClients[params.chain]
    if (!client) throw new Error(`No client found for chain: ${params.chain}`)

    const balance = await client.readContract({
      address: params.tokenAddress as `0x${string}`,
      abi: [{
        name: 'balanceOf',
        type: 'function',
        inputs: [{ name: 'owner', type: 'address' }],
        outputs: [{ name: 'balance', type: 'uint256' }],
        stateMutability: 'view'
      }],
      functionName: 'balanceOf',
      args: [params.walletAddress as `0x${string}`]
    })

    return balance
  }

  async getTokenData(chain: 'ethereum' | 'base', tokenAddress: string): Promise<Token> {
    const response = await fetch(`https://li.quest/v1/token?chain=${CHAIN_CONFIGS[chain].chainId}&token=${tokenAddress}`)
    const data = await response.json()
    return data.token
  }

  async getTokens(chain: 'ethereum' | 'base'): Promise<Token[]> {
    const response = await fetch(`https://li.quest/v1/tokens?chains=${CHAIN_CONFIGS[chain].chainId}&include=POPULAR`)
    const data = await response.json()
    return data.tokens
  }
}
