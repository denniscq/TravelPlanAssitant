'use client';

import { useEffect, useRef, useCallback } from 'react';
import { PoiItem } from '../../lib/types/poi-types';

interface MarkerWithPopupProps {
  mapInstance: AMap.Map | null;
  poi: PoiItem;
  isSelected: boolean;
  isHighlighted: boolean;
  markerIndex: number;
  onAddToItinerary: (poi: PoiItem) => void;
  onRemoveFromItinerary: (poi: PoiItem) => void;
  onHover?: (id: string | null) => void;
  markerOrder?: number;
  /** Custom background color for the marker (e.g. for proximity group coloring) */
  markerColor?: string;
}

export function MarkerWithPopup({
  mapInstance,
  poi,
  isSelected,
  isHighlighted,
  markerIndex,
  onAddToItinerary,
  onRemoveFromItinerary,
  onHover,
  markerOrder,
  markerColor,
}: MarkerWithPopupProps): React.ReactElement {
  const markerRef = useRef<AMap.Marker | null>(null);
  const infoWindowRef = useRef<AMap.InfoWindow | null>(null);

  const createInfoWindowContent = useCallback((): string => {
    const ratingText = poi.rating > 0 ? poi.rating.toFixed(1) : '暂无评分';

    let costLabel = '';
    if (poi.cost > 0) {
      costLabel = poi.category === 'attraction' ? `门票：¥${poi.cost}` : `人均：¥${poi.cost}`;
    } else if (poi.cost === 0) {
      costLabel = '';
    }

    const tagsText = (poi.tags?.length ?? 0) > 0 ? poi.tags.join(' | ') : '';
    const addressText = (poi.address?.length ?? 0) > 0 ? poi.address : '暂无地址';
    const openingText = (poi.openingTime?.length ?? 0) > 0 ? poi.openingTime : '';
    const phoneText = (poi.telephone?.length ?? 0) > 0 ? poi.telephone : '';

    return `
      <div style="padding: 12px; min-width: 220px; font-family: 'Patrick Hand', 'Caveat', cursive; border: 2px solid #44403c; background: #fff; box-shadow: 4px 4px 0px 0px rgba(0,0,0,0.15);">
        <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 700; color: #1c1917; font-family: 'Caveat', cursive;">
          ${poi.name}
        </h3>
        <div style="margin-bottom: 4px; font-size: 14px; color: #78716c;">
          <span>评分：${ratingText}</span>
          ${costLabel !== '' ? `<span style="margin-left: 12px;">${costLabel}</span>` : ''}
        </div>
        ${tagsText !== '' ? `<div style="margin-bottom: 4px; font-size: 14px; color: #78716c;">${tagsText}</div>` : ''}
        ${addressText !== '暂无地址' ? `<div style="margin-bottom: 4px; font-size: 14px; color: #78716c;">${addressText}</div>` : ''}
        ${openingText !== '' ? `<div style="margin-bottom: 4px; font-size: 14px; color: #78716c;">${openingText}</div>` : ''}
        ${phoneText !== '' ? `<div style="margin-bottom: 4px; font-size: 14px; color: #78716c;">${phoneText}</div>` : ''}
        <div style="margin-top: 8px;">
          ${
            isSelected
              ? `<button onclick="window.dispatchEvent(new CustomEvent('poi-remove', {detail: '${poi.id}'}))" style="padding: 4px 12px; background: #44403c; color: white; border: 2px solid #292524; cursor: pointer; font-size: 14px; font-family: 'Caveat', cursive; box-shadow: 3px 3px 0px 0px rgba(0,0,0,0.15);">移除行程</button>`
              : `<button onclick="window.dispatchEvent(new CustomEvent('poi-add', {detail: '${poi.id}'}))" style="padding: 4px 12px; background: #44403c; color: white; border: 2px solid #292524; cursor: pointer; font-size: 14px; font-family: 'Caveat', cursive; box-shadow: 3px 3px 0px 0px rgba(0,0,0,0.15);">+ 加入行程</button>`
          }
        </div>
      </div>
    `;
  }, [poi, isSelected]);

  const createMarkerContent = useCallback((): string => {
    const number = (markerOrder ?? markerIndex) + 1;

    // Priority: markerColor > selected color > default
    let bgColor = markerColor ?? '#fff';
    let textColor = '#1c1917';
    let borderColor = '#44403c';
    let borderWidth = 2;
    let glowShadow = '';

    if (isSelected) {
      bgColor = '#22c55e';
      textColor = '#fff';
      borderColor = '#16a34a';
    }

    if (isHighlighted) {
      borderColor = '#1c1917';
      borderWidth = 3;
      glowShadow = 'box-shadow: 0 0 0 4px rgba(0,0,0,0.15), 0 0 12px 4px rgba(0,0,0,0.1);';
    }

    // If markerColor is set and not selected, ensure text is readable
    if (markerColor !== undefined && !isSelected) {
      textColor = '#fff';
    }

    const orderBadge = markerOrder !== undefined
      ? `<div style="position: absolute; top: -14px; left: 50%; transform: translateX(-50%); background: #44403c; color: #fff; font-size: 10px; font-family: 'Caveat', cursive; padding: 0 5px; border: 2px solid #292524; line-height: 16px; white-space: nowrap;">#${markerOrder}</div>`
      : '';

    return `
      <div
        style="display: flex; flex-direction: column; align-items: center; cursor: pointer; position: relative; user-select: none;"
        data-poi-id="${poi.id}"
      >
        ${orderBadge}
        <div
          style="
            width: 32px; height: 32px; border-radius: 50%;
            background: ${bgColor}; color: ${textColor};
            border: ${borderWidth}px solid ${borderColor};
            display: flex; align-items: center; justify-content: center;
            font-family: 'Caveat', cursive;
            font-size: 14px; font-weight: 700;
            transition: all 0.15s ease;
            ${glowShadow}
          "
        >${number}</div>
      </div>
    `;
  }, [poi, isSelected, isHighlighted, markerIndex, markerOrder, markerColor]);

  // Handle click (toggle selection) and long-press (show info)
  useEffect(() => {
    if (mapInstance === null) return;

    const marker = new AMap.Marker({
      position: [poi.longitude, poi.latitude],
      map: mapInstance,
      content: createMarkerContent(),
      offset: new AMap.Pixel(-16, -16),
    });

    const infoWindow = new AMap.InfoWindow({
      content: createInfoWindowContent(),
      offset: new AMap.Pixel(0, -24),
      closeWhenClickMap: true,
    });

    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    let isLongPress = false;

    const handleMouseOver = () => {
      if (onHover !== undefined) onHover(poi.id);
      // Start hover timer: show popup after 500ms of hover
      if (hoverTimer !== null) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        infoWindow.open(mapInstance, marker.getPosition());
      }, 500);
    };

    const handleMouseLeave = () => {
      if (onHover !== undefined) onHover(null);
      if (hoverTimer !== null) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      if (pressTimer !== null) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    const handleMouseDown = () => {
      // Cancel hover timer on mousedown so click doesn't trigger hover popup
      if (hoverTimer !== null) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      isLongPress = false;
      pressTimer = setTimeout(() => {
        isLongPress = true;
        infoWindow.open(mapInstance, marker.getPosition());
      }, 2000);
    };

    const handleMouseUp = () => {
      if (pressTimer !== null) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      if (!isLongPress) {
        if (isSelected) {
          onRemoveFromItinerary(poi);
        } else {
          onAddToItinerary(poi);
        }
      }
    };

    // Use AMap marker events
    marker.on('mouseover', handleMouseOver);
    marker.on('mouseleave', handleMouseLeave);
    marker.on('mousedown', handleMouseDown);
    marker.on('mouseup', handleMouseUp);
    marker.on('touchstart', handleMouseDown);
    marker.on('touchend', handleMouseUp);
    marker.on('touchcancel', handleMouseLeave);

    markerRef.current = marker;
    infoWindowRef.current = infoWindow;

    return () => {
      if (pressTimer !== null) clearTimeout(pressTimer);
      if (hoverTimer !== null) clearTimeout(hoverTimer);
      marker.off('mouseover', handleMouseOver);
      marker.off('mouseleave', handleMouseLeave);
      marker.off('mousedown', handleMouseDown);
      marker.off('mouseup', handleMouseUp);
      marker.off('touchstart', handleMouseDown);
      marker.off('touchend', handleMouseUp);
      marker.off('touchcancel', handleMouseLeave);
      if (infoWindowRef.current !== null) {
        infoWindowRef.current.close();
      }
      if (markerRef.current !== null) {
        markerRef.current.setMap(null);
      }
    };
  }, [mapInstance, poi, isSelected, onAddToItinerary, onRemoveFromItinerary, onHover, createMarkerContent, createInfoWindowContent]);

  // Update marker content when isSelected or isHighlighted changes
  useEffect(() => {
    if (markerRef.current !== null) {
      markerRef.current.setContent(createMarkerContent());
    }
  }, [isSelected, isHighlighted, createMarkerContent]);

  // Update InfoWindow content when isSelected changes
  useEffect(() => {
    if (infoWindowRef.current !== null && mapInstance !== null) {
      infoWindowRef.current.setContent(createInfoWindowContent());
    }
  }, [isSelected, createInfoWindowContent, mapInstance]);

  // Listen for CustomEvent from InfoWindow buttons
  useEffect(() => {
    const addPoiHandler = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail === poi.id) {
        onAddToItinerary(poi);
      }
    };

    const removePoiHandler = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail === poi.id) {
        onRemoveFromItinerary(poi);
      }
    };

    window.addEventListener('poi-add', addPoiHandler);
    window.addEventListener('poi-remove', removePoiHandler);

    return () => {
      window.removeEventListener('poi-add', addPoiHandler);
      window.removeEventListener('poi-remove', removePoiHandler);
    };
  }, [poi, onAddToItinerary, onRemoveFromItinerary]);

  return <></>;
}