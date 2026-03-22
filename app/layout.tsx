import type {Metadata} from 'next';
import { Poppins, Inter } from 'next/font/google';
import './globals.css';

const poppins = Poppins({
  weight: ['400', '600'],
  subsets: ['latin'],
  variable: '--font-poppins',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Companion - Voice Assistant',
  description: 'A warm, friendly voice-based companion app.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${poppins.variable} ${inter.variable}`}>
      <body suppressHydrationWarning className="font-inter bg-[#FFF7F0] text-[#2F2E2E]">{children}</body>
    </html>
  );
}
