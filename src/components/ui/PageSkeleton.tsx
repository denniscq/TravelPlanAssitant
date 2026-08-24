'use client';

export function PageSkeleton(): React.ReactElement {
  return (
    <div className="mx-auto max-w-4xl animate-pulse">
      {/* Title skeleton */}
      <div className="mb-8">
        <div className="h-8 w-64 font-caveat text-3xl text-stone-300">旅行路线规划</div>
        <div className="mt-2 h-4 w-96 rounded bg-stone-200" />
      </div>

      {/* Step bar skeleton */}
      <div className="mb-8 flex items-center justify-between">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-1 items-center">
            <div className="mx-auto flex flex-col items-center">
              <div className="h-10 w-10 border-2 border-stone-200 bg-white" />
              <div className="mt-1 h-3 w-14 rounded bg-stone-200" />
            </div>
            {i < 4 && <div className="mx-2 mt-[-1.5rem] flex-1 border-t-2 border-stone-200" style={{ borderStyle: 'dashed' }} />}
          </div>
        ))}
      </div>

      {/* Content skeleton */}
      <div className="border-2 border-stone-300 bg-white/90 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)]">
        <div className="mb-6">
          <div className="h-6 w-40 font-caveat text-xl text-stone-300">加载中...</div>
          <div className="mt-2 h-4 w-72 rounded bg-stone-100" />
        </div>

        {/* Map skeleton */}
        <div className="mb-6 h-[400px] bg-stone-100 border-2 border-stone-200" style={{ borderStyle: 'dashed' }} />

        {/* Button skeleton */}
        <div className="flex justify-end">
          <div className="h-10 w-28 border-2 border-stone-200 bg-stone-100" />
        </div>
      </div>
    </div>
  );
}