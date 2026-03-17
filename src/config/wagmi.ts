import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { base } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'Chess Game',
  projectId: '18a6f3148e257b62b65c0ff598a24d5e',
  chains: [base],
  ssr: true,
});
