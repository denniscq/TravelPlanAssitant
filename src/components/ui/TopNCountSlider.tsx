'use client';

interface TopNCountSliderProps {
  value: number;
  minValue: number;
  maxValue: number;
  onChange: (newValue: number) => void;
  label?: string;
}

export function TopNCountSlider({
  value,
  minValue,
  maxValue,
  onChange,
  label = '显示数量',
}: TopNCountSliderProps): React.ReactElement {
  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between">
        <label className="pencil-label text-sm">{label}</label>
        <span className="font-caveat text-sm font-bold text-stone-700">{value}</span>
      </div>
      <input
        type="range"
        min={minValue}
        max={maxValue}
        value={value}
        onChange={(event) => {
          onChange(parseInt(event.target.value, 10));
        }}
        className="h-2 w-full cursor-pointer appearance-none bg-stone-200 accent-stone-700"
        style={{ borderRadius: 0, border: '2px solid #a8a29e' }}
        aria-label={label}
      />
      <div className="mt-1 flex justify-between font-caveat text-xs text-stone-400">
        <span>{minValue}</span>
        <span>{maxValue}</span>
      </div>
    </div>
  );
}