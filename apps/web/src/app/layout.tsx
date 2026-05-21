import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Discord Bot Admin',
  description: 'Administration dashboard for the Discord bot.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
