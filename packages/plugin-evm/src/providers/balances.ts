import { Address, formatUnits } from 'viem'
import type { TokenProvider } from './token'
import type { WalletBalance, TokenBalance, SupportedChain } from '../types'
import type { Token } from '@lifi/types'

const PROVIDER_CONFIG = {
  PRICE_API: 'https://li.quest/v1',
  NATIVE_TOKEN: {
    ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    base: '0x4200000000000000000000000000000000000006'
  }
} as const

export class BalancesProvider {
  constructor(
    private tokenProvider: TokenProvider,
    private walletAddress: Address
  ) {}

  private async getTokenPrice(chain: SupportedChain, tokenAddress: Address): Promise<string> {
    try {
      const response = await fetch(
        `${PROVIDER_CONFIG.PRICE_API}/token?chain=${chain}&token=${tokenAddress}`
      )
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      return data.priceUSD || '0'
    } catch (error) {
      console.error(`Failed to fetch price for ${tokenAddress} on ${chain}:`, error)
      return '0'
    }
  }

  async getWalletBalances(chains: SupportedChain[]): Promise<WalletBalance[]> {
    return Promise.all(
      chains.map(async (chain): Promise<WalletBalance> => {
        const tokens = await this.tokenProvider.getTokens(chain)
        
        const balancePromises = tokens.map(async (token): Promise<TokenBalance> => {
          const [balance, price] = await Promise.all([
            this.tokenProvider.getTokenBalance({
              chain,
              tokenAddress: token.address as Address,
              walletAddress: this.walletAddress
            }),
            this.getTokenPrice(chain, token.address as Address)
          ])

          const formattedBalance = formatUnits(balance, token.decimals)
          const value = (Number(formattedBalance) * Number(price)).toString()

          return {
            symbol: token.symbol,
            decimals: token.decimals,
            address: token.address as Address,
            name: token.name,
            priceUSD: price,
            logoURI: token.logoURI,
            chainId: token.chainId,
            balance,
            price,
            value
          }
        })

        const balances = await Promise.all(balancePromises)
        const nonZeroBalances = balances.filter(t => t.balance > 0n)
        
        const totalValueUSD = nonZeroBalances
          .reduce((sum, t) => sum + Number(t.value || 0), 0)
          .toFixed(2)

        return {
          chain,
          address: this.walletAddress,
          totalValueUSD,
          tokens: nonZeroBalances
        }
      })
    )
  }
}
