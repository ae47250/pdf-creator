import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'PDF Creation Service',
  description: 'Internal authenticated HTML-to-PDF service and testing console.',
  robots: { index: false, follow: false, noarchive: true }
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
