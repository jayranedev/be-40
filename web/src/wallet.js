import { createWeb3Modal } from '@web3modal/wagmi/react';
import { fallback, http, createConfig } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import { walletConnect } from 'wagmi/connectors';

const envProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
const projectId = envProjectId || 'demo';
const hasProjectId = Boolean(envProjectId);
const envRpcUrl = import.meta.env.VITE_BASE_SEPOLIA_RPC_URL;
const fallbackRpcs = [
  envRpcUrl,
  'https://sepolia.base.org',
  'https://base-sepolia.publicnode.com',
  'https://base-sepolia.blockpi.network/v1/rpc/public',
].filter(Boolean);

export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  transports: {
    [baseSepolia.id]:
      fallbackRpcs.length > 1
        ? fallback(fallbackRpcs.map((url) => http(url)))
        : http(fallbackRpcs[0]),
  },
  connectors: hasProjectId
    ? [
        walletConnect({
          projectId,
          metadata: {
            name: 'FaceID SBT Identity',
            description: 'Privacy-preserving identity verification on Base',
            url: window.location.origin,
            icons: ['https://avatars.githubusercontent.com/u/37784886'],
          },
        }),
      ]
    : [],
});

createWeb3Modal({
  wagmiConfig,
  projectId,
  enableAnalytics: false,
  enableOnramp: false,
  themeMode: 'light',
  themeVariables: {
    '--w3m-accent': '#f59e0b',
    '--w3m-border-radius-master': '12px',
  },
  defaultChain: baseSepolia,
});

export { hasProjectId };
