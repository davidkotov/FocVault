import { defineChain } from 'viem'

export const filecoin = defineChain({
  id: 314,
  name: 'Filecoin',
  nativeCurrency: { name: 'Filecoin', symbol: 'FIL', decimals: 18 },
  rpcUrls: { default: { http: ['https://api.node.glif.io/rpc/v1'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://filecoin.blockscout.com' } }
})

export const filecoinCalibration = defineChain({
  id: 314159,
  name: 'Filecoin Calibration',
  nativeCurrency: { name: 'Filecoin', symbol: 'FIL', decimals: 18 },
  rpcUrls: { default: { http: ['https://api.calibration.node.glif.io/rpc/v1'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://filecoin-testnet.blockscout.com' } }
})

export const USDFC: Record<number, `0x${string}`> = {
  [filecoin.id]: '0x80B98d3aa09ffff255c3ba4A241111Ff1262F045',
  [filecoinCalibration.id]: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
}

export const USDFC_DECIMALS = 18

export const SUPPORTED_CHAIN_IDS: number[] = [filecoinCalibration.id, filecoin.id]

export function isSupportedChain(chainId: number | undefined): boolean {
  return chainId !== undefined && SUPPORTED_CHAIN_IDS.includes(chainId)
}

export function usdfcFor(chainId: number | undefined): `0x${string}` | undefined {
  if (chainId === undefined) return undefined
  return USDFC[chainId]
}

export const SUB_GATE_ADDRESS = (process.env.NEXT_PUBLIC_SUB_GATE_ADDRESS ?? '') as `0x${string}` | ''
