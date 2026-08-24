'use client';

interface ProximityLegendProps {
  /** Map of groupId -> color hex */
  colors: Record<string, string>;
  /** Map of groupId -> display name */
  groupNames: Record<string, string>;
}

export function ProximityLegend({
  colors,
  groupNames,
}: ProximityLegendProps): React.ReactElement {
  const entries = Object.entries(colors);

  if (entries.length === 0) return <></>;

  return (
    <div className="rounded border-2 border-stone-400 bg-white p-2 shadow-[3px_3px_0px_0px_rgba(0,0,0,0.12)]">
      <p className="mb-1.5 font-caveat text-xs font-bold text-stone-600">
        颜色标记说明
      </p>
      <div className="flex flex-col gap-1">
        {entries.map(([groupId, color]) => (
          <div key={groupId} className="flex items-center gap-2">
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="truncate font-caveat text-xs text-stone-700">
              {groupNames[groupId] ?? groupId}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}