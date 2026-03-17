import type { Metadata } from 'next';
import { Providers } from './providers';
import { Toaster } from 'react-hot-toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chess Game on Base',
  description: 'Play chess against AI or other players with USDT stakes on Base network',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Toaster position="top-right" toastOptions={{ style: { background: '#1e293b', color: '#e2e8f0' } }} />
          {children}
        </Providers>
      </body>
    </html>
  );
}
