import { ByteArray, parseEther, type Hex } from 'viem'
import { WalletProvider } from '../providers/wallet'
import type { Transaction, TransferParams } from '../types'
import { transferTemplate } from '../templates'
import type { Action, IAgentRuntime, Memory, State } from '@ai16z/eliza'

export { transferTemplate }
export class TransferAction {
  constructor(private walletProvider: WalletProvider) {}

  async transfer(params: TransferParams): Promise<Transaction> {
    const walletClient = this.walletProvider.getWalletClient()
    const [fromAddress] = await walletClient.getAddresses()

    await this.walletProvider.switchChain(params.fromChain)

    try {
      const hash = await walletClient.sendTransaction({
        account: fromAddress,
        to: params.toAddress,
        value: parseEther(params.amount),
        data: params.data as Hex,
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
        to: params.toAddress,
        value: parseEther(params.amount),
        data: params.data as Hex
      }
    } catch (error) {
      throw new Error(`Transfer failed: ${error.message}`)
    }
  }
}

export const transferAction: Action = {
  name: 'transfer',
  description: 'Transfer tokens between addresses on the same chain',
  handler: async (runtime: IAgentRuntime, message: Memory, state: State, options: any) => {
    const walletProvider = new WalletProvider(runtime)
    const action = new TransferAction(walletProvider)
    return action.transfer(options)
  },
  validate: async (runtime: IAgentRuntime) => {
    const privateKey = runtime.getSetting("EVM_PRIVATE_KEY")
    return typeof privateKey === 'string' && privateKey.startsWith('0x')
  },
  examples: [
    [
      {
        user: "assistant",
        content: {
          text: "I'll help you transfer 1 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
          action: "SEND_TOKENS"
        }
      },
      {
        user: "user",
        content: {
          text: "Transfer 1 ETH to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
          action: "SEND_TOKENS"
        }
      }
    ],
    [
      {
        user: "assistant",
        content: {
          text: "I'll help you send 500 USDC to vitalik.eth",
          action: "SEND_TOKENS"
        }
      },
      {
        user: "user",
        content: {
          text: "Send 500 USDC to vitalik.eth",
          action: "SEND_TOKENS"
        }
      }
    ],
    [
      {
        user: "assistant",
        content: {
          text: "I'll help you move 0.5 ETH to my other wallet 0x123...",
          action: "SEND_TOKENS"
        }
      },
      {
        user: "user",
        content: {
          text: "Move 0.5 ETH to my other wallet 0x123...",
          action: "SEND_TOKENS"
        }
      }
    ]
  ],
  similes: [
    'SEND_TOKENS',
    'TOKEN_TRANSFER',
    'MOVE_TOKENS',
    'SEND_COINS',
    'TRANSFER_FUNDS',
    'SEND_FUNDS',
    'WALLET_TRANSFER',
    'SEND_CRYPTO'
  ]
}
