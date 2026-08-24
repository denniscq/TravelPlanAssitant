'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { PoiItem } from '../../lib/types/poi-types';

interface PoiListPanelProps {
  pois: PoiItem[];
  selectedIds: Set<string>;
  highlightedId: string | null;
  onHighlight: (id: string | null) => void;
  onSelect: (poi: PoiItem) => void;
  onLocate: (poi: PoiItem) => void;
  label: string;
  className?: string;
  /** Map of groupId -> hex color for proximity-based coloring */
  proximityColors?: Record<string, string>;
}

const ITEM_HEIGHT = 46;

export function PoiListPanel({
  pois,
  selectedIds,
  highlightedId,
  onHighlight,
  onSelect,
  onLocate,
  label,
  className = '',
  proximityColors,
}: PoiListPanelProps): React.ReactElement {
  const listRef = useRef<HTMLDivElement>(null);
  const scrollThumbRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const [scrollAreaHeight, setScrollAreaHeight] = useState(322);

  // Track the actual scroll area height via ResizeObserver for scrollbar thumb sizing
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (el === null) return;

    const updateHeight = (): void => {
      setScrollAreaHeight(el.clientHeight);
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  const totalHeight = pois.length * ITEM_HEIGHT;
  const scrollRatio = scrollAreaHeight / totalHeight;
  const thumbHeight = Math.max(scrollRatio * scrollAreaHeight, 24);

  // Auto-scroll to highlighted item
  useEffect(() => {
    if (highlightedId === null) return;
    const el = document.getElementById(`poi-list-item-${highlightedId}`);
    if (el !== null) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [highlightedId]);

  // Sync custom scrollbar thumb position with list scroll
  const handleListScroll = useCallback(() => {
    const list = listRef.current;
    const thumb = scrollThumbRef.current;
    const track = trackRef.current;
    if (list === null || thumb === null || track === null) return;

    const scrollable = list.scrollHeight - list.clientHeight;
    if (scrollable <= 0) {
      thumb.style.top = '0px';
      return;
    }
    const ratio = list.scrollTop / scrollable;
    const maxTop = track.clientHeight - thumbHeight;
    thumb.style.top = `${ratio * maxTop}px`;
  }, [thumbHeight]);

  // Drag custom scrollbar thumb
  const isDragging = useRef(false);

  const handleTrackMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const list = listRef.current;
      const track = trackRef.current;
      if (list === null || track === null) return;

      const rect = track.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const scrollable = list.scrollHeight - list.clientHeight;
      if (scrollable <= 0) return;

      const ratio = clickY / track.clientHeight;
      list.scrollTop = ratio * scrollable;
    },
    [],
  );

  const handleThumbMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      isDragging.current = true;
      const startY = e.clientY;
      const startScrollTop = listRef.current?.scrollTop ?? 0;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;
        const list = listRef.current;
        const track = trackRef.current;
        if (list === null || track === null) return;

        const deltaY = moveEvent.clientY - startY;
        const scrollable = list.scrollHeight - list.clientHeight;
        if (scrollable <= 0) return;

        const ratio = deltaY / track.clientHeight;
        list.scrollTop = startScrollTop + ratio * scrollable;
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [],
  );

  return (
    <div className={`${className} flex flex-col overflow-hidden border-2 border-stone-400 bg-stone-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)]`}>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-stone-300 bg-stone-100 px-3 py-2">
        <span className="font-caveat text-sm font-bold text-stone-700">
          {label}（{pois.length}）
        </span>
      </div>

      {/* List area with left-side custom scrollbar */}
      <div ref={scrollAreaRef} className="flex flex-1 min-h-0">
        {/* Custom scrollbar track (left side) */}
        <div
          ref={trackRef}
          className="relative w-4 shrink-0 cursor-pointer border-r-2 border-stone-300 bg-stone-200"
          onMouseDown={handleTrackMouseDown}
        >
          <div
            ref={scrollThumbRef}
            className="absolute left-0.5 right-0.5 cursor-grab active:cursor-grabbing border-2 border-stone-500 bg-stone-100 transition-all hover:bg-stone-200"
            style={{
              height: `${thumbHeight}px`,
              top: '0px',
              boxShadow: '2px 2px 0px 0px rgba(0,0,0,0.1)',
            }}
            onMouseDown={handleThumbMouseDown}
          />
        </div>

        {/* Scrollable list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto scrollbar-hidden"
          onScroll={handleListScroll}
        >
          {pois.map((poi, index) => {
            const isSelected = selectedIds.has(poi.id);
            const isHighlighted = highlightedId === poi.id;

            return (
              <div
                key={poi.id}
                id={`poi-list-item-${poi.id}`}
                className={`flex items-center gap-2 border-b border-stone-200 px-3 py-2.5 cursor-pointer transition-colors ${
                  isHighlighted ? 'bg-stone-200' : 'hover:bg-stone-100'
                }`}
                style={{ height: `${ITEM_HEIGHT}px` }}
                onMouseEnter={() => onHighlight(poi.id)}
                onMouseLeave={() => onHighlight(null)}
                onClick={() => onLocate(poi)}
              >
                {/* Number badge */}
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold font-caveat transition-colors ${
                    isSelected
                      ? 'bg-green-500 text-white'
                      : isHighlighted
                        ? 'bg-stone-800 text-white'
                        : proximityColors !== undefined
                          ? 'text-white'
                          : 'bg-stone-300 text-stone-700'
                  }`}
                  style={
                    !isSelected && !isHighlighted && proximityColors !== undefined && poi.proximityGroupId !== undefined
                      ? { backgroundColor: proximityColors[poi.proximityGroupId] ?? '#a8a29e' }
                      : undefined
                  }
                >
                  {index + 1}
                </span>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-caveat text-sm font-semibold text-stone-800">
                      {poi.name}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 truncate font-caveat text-xs">
                    {poi.rating > 0 && (
                      <span className="shrink-0 font-bold text-amber-600">
                        ★ {poi.rating.toFixed(1)}
                      </span>
                    )}
                    {poi.cost > 0 && (
                      <span className="shrink-0 text-stone-500">
                        ¥{poi.cost}
                      </span>
                    )}
                    {(poi.tags?.length ?? 0) > 0 && (
                      <span className="truncate text-stone-400">
                        {poi.tags.join(' | ')}
                      </span>
                    )}
                    {poi.proximityGroupName !== undefined && (
                      <span className="shrink-0 truncate font-semibold text-stone-400" title={poi.proximityGroupName}>
                        📍 {poi.proximityGroupName}
                      </span>
                    )}
                  </div>
                </div>

                {/* Select toggle - icon only */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(poi);
                  }}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    isSelected
                      ? 'border-green-400 bg-green-100 text-green-600'
                      : 'border-stone-400 bg-stone-100 text-stone-500 hover:border-stone-500 hover:bg-stone-200'
                  }`}
                  title={isSelected ? 'Remove' : 'Select'}
                >
                  {isSelected ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                      <path d="M4 8h8" stroke="currentColor" strokeWidth="2" fill="none" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" fill="none" />
                    </svg>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}