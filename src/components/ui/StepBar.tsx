'use client';

interface StepBarProps {
  currentStep: number;
  totalSteps: number;
  stepLabels: string[];
}

export function StepBar({
  currentStep,
  totalSteps,
  stepLabels,
}: StepBarProps): React.ReactElement {
  return (
    <nav className="mb-2 sm:mb-4" aria-label="Progress steps">
      <div className="flex items-center justify-between">
        {Array.from({ length: totalSteps }, (_, index) => {
          const stepNumber = index + 1;
          const isActive = stepNumber === currentStep;
          const isCompleted = stepNumber < currentStep;

          return (
            <div key={stepNumber} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center border-2 font-caveat text-sm sm:text-lg font-bold transition-all ${
                    isCompleted
                      ? 'border-stone-600 bg-stone-800 text-white'
                      : isActive
                      ? 'border-stone-600 bg-white text-stone-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.15)]'
                      : 'border-stone-300 bg-white text-stone-400'
                  }`}
                  aria-current={isActive ? 'step' : undefined}
                >
                  {isCompleted ? (
                    <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    stepNumber
                  )}
                </div>
                <span
                  className={`hidden sm:block mt-1 text-xs font-semibold ${
                    isActive || isCompleted ? 'text-stone-700' : 'text-stone-400'
                  }`}
                >
                  {stepLabels[index]}
                </span>
              </div>
              {index < totalSteps - 1 && (
                <div
                  className={`mx-1 sm:mx-2 mt-[-1.5rem] flex-1 border-t-2 ${
                    isCompleted ? 'border-stone-600' : 'border-stone-300'
                  }`}
                  style={{ borderStyle: 'dashed' }}
                />
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}