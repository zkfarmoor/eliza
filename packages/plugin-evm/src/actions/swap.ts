import type { Route, RoutesRequest, TransactionRequest as LiFiTransactionRequest } from '@lifi/types'
import type { WalletProvider } from '../providers/wallet'
import type { Transaction, SwapParams } from '../types'
import { CHAIN_CONFIGS } from '../providers/wallet'
import { ByteArray, type Hex } from 'viem'

export const swapTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested token swap:
- Input token symbol or address (the token being sold)
- Output token symbol or address (the token being bought)
- Amount to swap
- Chain to execute on (ethereum or base)

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:

\`\`\`json
{
    "inputToken": string | null,
    "outputToken": string | null,
    "amount": string | null,
    "chain": "ethereum" | "base" | null,
    "slippage": number | null
}
\`\`\`
`

export class SwapAction {
  constructor(private walletProvider: WalletProvider) {}

  async swap(params: SwapParams): Promise<Transaction> {
    const walletClient = this.walletProvider.getWalletClient()
    const [fromAddress] = await walletClient.getAddresses()

    await this.walletProvider.switchChain(params.chain)

    const routeRequest: RoutesRequest = {
      fromChainId: CHAIN_CONFIGS[params.chain].chainId,
      toChainId: CHAIN_CONFIGS[params.chain].chainId,
      fromTokenAddress: params.fromToken,
      toTokenAddress: params.toToken,
      fromAmount: params.amount,
      fromAddress: fromAddress,
      options: {
        slippage: params.slippage || 0.5,
        order: 'RECOMMENDED'
      }
    }

    const response = await fetch('https://li.quest/v1/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routeRequest)
    })

    const { routes } = await response.json()
    if (!routes.length) throw new Error('No routes found')

    const route = routes[0] as Route
    const lifiTxRequest = route.steps[0].transactionRequest as LiFiTransactionRequest

    try {
      const hash = await walletClient.sendTransaction({
        account: fromAddress,
        to: lifiTxRequest.to as Hex,
        data: lifiTxRequest.data as Hex,
        value: BigInt(lifiTxRequest.value || 0),
        kzg: {
          blobToKzgCommitment: function (blob: ByteArray): ByteArray {
            throw new Error('Function not implemented.')
          },
          computeBlobKzgProof: function (blob: ByteArray, commitment: ByteArray): ByteArray {
            throw new Error('Function not implemented.')
          }
        },
        chain: undefined
      })

      return {
        hash,
        from: fromAddress,
        to: lifiTxRequest.to as Hex,
        value: BigInt(params.amount),
        data: lifiTxRequest.data as Hex
      }
    } catch (error) {
      throw new Error(`Swap failed: ${error.message}`)
    }
  }
}
