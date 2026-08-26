import type { Metadata } from 'next';
import { Caveat, Patrick_Hand } from 'next/font/google';
import './globals.css';
import { LoggerInitializer } from '../components/shared/LoggerInitializer';

const caveat = Caveat({
  subsets: ['latin'],
  variable: '--font-caveat',
  display: 'swap',
});

const patrickHand = Patrick_Hand({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-patrick',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'TravelPlanAssistant | AI-Powered Travel Route Planner',
    template: '%s | TravelPlanAssistant',
  },
  description:
    'AI 智能旅行路线规划工具，发现热门景点和特色餐厅，生成最优路线，不走回头路。',
  keywords: [
    '旅行规划',
    '路线规划',
    'AI 旅行',
    '行程规划',
    '旅游路线',
    '景点推荐',
    '餐厅推荐',
    '自由行路线',
  ],
  openGraph: {
    title: 'TravelPlanAssistant | AI 智能旅行路线规划',
    description:
      'AI 智能旅行路线规划工具，发现热门景点和特色餐厅，生成最优路线，不走回头路。',
    type: 'website',
    locale: 'zh_CN',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TravelPlanAssistant | AI 智能旅行路线规划',
    description:
      'AI 智能旅行路线规划工具，生成最优路线，不走回头路。',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'TravelPlanAssistant',
    description:
      'AI 智能旅行路线规划工具，帮助发现热门景点和特色餐厅，生成最优旅行路线。',
    applicationCategory: 'TravelApplication',
    operatingSystem: 'All',
    browserRequirements: 'Requires JavaScript',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'CNY',
    },
  };

  return (
    <html lang="zh-CN" className={`${caveat.variable} ${patrickHand.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="flex min-h-screen flex-col bg-stone-50 font-patrick">
        <LoggerInitializer />
        <header className="border-b border-stone-300 bg-white/80 shadow-sm" style={{ borderStyle: 'dashed' }}>
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <svg
                className="h-6 w-6 text-stone-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                />
              </svg>
              <span className="text-lg font-semibold text-stone-800 font-caveat text-xl">
                TravelPlanAssistant
              </span>
            </div>
            <nav className="flex items-center gap-4">
              <span className="text-xs text-stone-400">
                Hope you have a good travel!
              </span>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {children}
        </main>
        <footer className="border-t border-stone-300 bg-white/80 py-4" style={{ borderStyle: 'dashed' }}>
          <div className="mx-auto max-w-6xl px-4 text-center text-xs text-stone-400 font-caveat text-base">
            TravelPlanAssistant — 智能规划你的旅行路线
          </div>
        </footer>
      </body>
    </html>
  );
}