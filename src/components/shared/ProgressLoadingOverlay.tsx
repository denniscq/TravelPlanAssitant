'use client';

import { useState, useEffect, useRef } from 'react';

interface ProgressStep {
  label: string;
  range: [number, number];
  duration: number;
}

const STEPS: ProgressStep[] = [
  { label: '正在准备行程数据...', range: [0, 15], duration: 1500 },
  { label: '正在调用AI规划最优路线...', range: [15, 50], duration: 8000 },
  { label: '正在生成详细出行计划...', range: [50, 70], duration: 3000 },
  { label: '正在获取实时路线数据...', range: [70, 85], duration: 3000 },
  { label: '正在生成路线简图...', range: [85, 92], duration: 2000 },
];

interface ProgressLoadingOverlayProps {
  isLoading: boolean;
}

export function ProgressLoadingOverlay({
  isLoading,
}: ProgressLoadingOverlayProps): React.ReactElement | null {
  const [progress, setProgress] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!isLoading) {
      setProgress(0);
      setCurrentStepIndex(0);
      return;
    }

    startTimeRef.current = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTimeRef.current;
      let cumulativeDuration = 0;
      let stepIdx = 0;

      for (let i = 0; i < STEPS.length; i++) {
        cumulativeDuration += STEPS[i].duration;
        if (elapsed < cumulativeDuration) {
          stepIdx = i;
          break;
        }
        stepIdx = i;
      }

      setCurrentStepIndex(stepIdx);

      const step = STEPS[stepIdx];
      const stepStart = step.range[0];
      const stepEnd = step.range[1];
      const stepDuration = step.duration;

      const elapsedInStep = elapsed - (cumulativeDuration - stepDuration);
      const stepProgress = Math.min(elapsedInStep / stepDuration, 1);
      const currentProgress = stepStart + (stepEnd - stepStart) * stepProgress;

      setProgress(Math.min(currentProgress, 95));

      if (elapsed < cumulativeDuration) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [isLoading]);

  // Jump to 100% when the loading completes
  useEffect(() => {
    if (!isLoading && progress > 0) {
      setProgress(100);
    }
  }, [isLoading, progress]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isLoading) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/20 backdrop-blur-sm">
      <div className="w-80 border-2 border-stone-400 bg-white/90 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)]">
        <p className="mb-4 text-center font-caveat text-base text-stone-700">
          {STEPS[currentStepIndex]?.label ?? '加载中...'}
        </p>

        {/* Progress bar */}
        <div className="h-3 overflow-hidden border-2 border-stone-400 bg-stone-100">
          <div
            className="h-full bg-stone-600 transition-all duration-200 ease-out"
            style={{ width: Math.round(progress) + '%' }}
          />
        </div>

        <p className="mt-2 text-right font-caveat text-sm text-stone-500">
          {Math.round(progress)}%
        </p>
      </div>
    </div>
  );
}