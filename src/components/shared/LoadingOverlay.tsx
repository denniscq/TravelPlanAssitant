'use client';

interface LoadingOverlayProps {
  isLoading: boolean;
  message?: string;
}

export function LoadingOverlay({
  isLoading,
  message = '加载中...',
}: LoadingOverlayProps): React.ReactElement | null {
  if (!isLoading) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/20 backdrop-blur-sm loading-overlay">
      <div className="border-2 border-stone-400 bg-white/90 px-8 py-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)]">
        <div className="mb-3 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin border-2 border-stone-300 border-t-stone-600" />
        </div>
        <p className="font-caveat text-sm text-stone-600">{message}</p>
      </div>
    </div>
  );
}