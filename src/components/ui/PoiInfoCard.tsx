'use client';

import { PoiItem } from '../../lib/types/poi-types';

interface PoiInfoCardProps {
  poi: PoiItem;
  isSelected: boolean;
  onAddToItinerary: (poi: PoiItem) => void;
  onRemoveFromItinerary: (poi: PoiItem) => void;
}

export function PoiInfoCard({
  poi,
  isSelected,
  onAddToItinerary,
  onRemoveFromItinerary,
}: PoiInfoCardProps): React.ReactElement {
  const rating = poi.rating ?? 0;
  const cost = poi.cost ?? 0;
  const tags = poi.tags ?? [];
  const address = poi.address ?? '';
  const openingTime = poi.openingTime ?? '';

  return (
    <article className="pencil-card">
      <div className="mb-2 flex items-start justify-between">
        <h3 className="font-caveat text-lg font-semibold text-stone-800">{poi.name}</h3>
        <div className="flex items-center gap-1">
          <svg className="h-4 w-4 text-stone-500" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
          <span className="font-caveat text-sm font-medium text-stone-600">
            {rating > 0 ? rating.toFixed(1) : 'N/A'}
          </span>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tags.slice(0, 3).filter(Boolean).map((tag) => (
            <span key={tag} className="pencil-badge">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mb-3 space-y-1 text-sm text-stone-500">
        {address.length > 0 && <p className="truncate">{address}</p>}
        {cost > 0 && <p className="font-caveat text-sm">人均消费：¥{cost}</p>}
        {openingTime.length > 0 && <p className="truncate">{openingTime}</p>}
      </div>

      <button
        type="button"
        onClick={() => {
          if (isSelected) {
            onRemoveFromItinerary(poi);
          } else {
            onAddToItinerary(poi);
          }
        }}
        className={`w-full ${isSelected ? 'pencil-btn' : 'pencil-btn-primary'} text-sm`}
      >
        {isSelected ? '已选择' : '加入行程'}
      </button>
    </article>
  );
}