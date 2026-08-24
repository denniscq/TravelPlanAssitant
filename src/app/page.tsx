import dynamic from 'next/dynamic';

const HomePageClient = dynamic(() => import('./page.client'), { ssr: false });

export default function HomePage(): React.ReactElement {
  return <HomePageClient />;
}