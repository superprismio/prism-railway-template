import type { Metadata } from 'next';
import { Space_Grotesk, Space_Mono } from 'next/font/google';

import { ThemeProvider } from '@/components/shared/theme-provider';

import './globals.css';

const defaultUrl = process.env.APP_URL ? `https://${process.env.APP_URL}` : 'http://localhost:3100';

const sans = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['300', '400', '500', '700'],
});

const mono = Space_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '700'],
});

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: 'Prism Agent Railway',
  description: 'Railway-first community agent scaffold',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} antialiased`}>
        <ThemeProvider>
          <main className="min-h-screen flex flex-col items-center w-full">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
