'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface SuggestionItem {
  name: string;
  address: string;
  location: string;
  district: string;
  adcode: string;
}

interface PlaceAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: { name: string; location: [number, number]; address: string }) => void;
  placeholder: string;
  label: string;
}

export function PlaceAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  label,
}: PlaceAutocompleteProps): React.ReactElement {
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const suppressFetchRef = useRef(false);
  const hasInteractedRef = useRef(false);

  useEffect(() => {
    // Skip fetching until user has interacted with this input
    if (!hasInteractedRef.current) {
      return;
    }

    // Skip fetching when value was set by a selection, not by typing
    if (suppressFetchRef.current) {
      suppressFetchRef.current = false;
      return;
    }

    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    if (debounceRef.current !== undefined) {
      clearTimeout(debounceRef.current);
    }

    const abortController = new AbortController();

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ keywords: value.trim() });
        const response = await fetch(`/api/amap/inputtip?${params.toString()}`, {
          signal: abortController.signal,
        });
        if (abortController.signal.aborted) return;

        const result = await response.json();
        if (abortController.signal.aborted) return;

        if (result.success) {
          setSuggestions(result.data);
          setShowDropdown(result.data.length > 0);
        } else {
          setSuggestions([]);
        }
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSuggestions([]);
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 500);

    return () => {
      abortController.abort();
      if (debounceRef.current !== undefined) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [value]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current !== null &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current !== null &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = useCallback(
    (item: SuggestionItem) => {
      // Prevent the useEffect from re-fetching after selection
      suppressFetchRef.current = true;
      onChange(item.name);
      setShowDropdown(false);

      const [lng, lat] = item.location.split(',').map(Number);
      if (!isNaN(lng) && !isNaN(lat)) {
        onSelect({
          name: item.name,
          location: [lng, lat],
          address: item.address,
        });
      }
    },
    [onChange, onSelect]
  );

  return (
    <div className="relative">
      <label className="pencil-label text-xs mb-1">{label}</label>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            hasInteractedRef.current = true;
            onChange(e.target.value);
          }}
          onFocus={() => {
            // Only show dropdown if user has interacted AND already has suggestions visible
            if (suggestions.length > 0 && hasInteractedRef.current && value.trim().length >= 2) {
              setShowDropdown(true);
            }
          }}
          placeholder={placeholder}
          className="pencil-input w-full text-sm font-caveat"
        />
        {isLoading && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
          </div>
        )}
      </div>
      {showDropdown && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto border-2 border-stone-400 bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)] font-caveat"
        >
          {suggestions.map((item, index) => (
            <button
              key={item.name + index}
              type="button"
              onClick={() => handleSelect(item)}
              className="w-full border-b border-stone-200 px-3 py-2 text-left hover:bg-stone-100 font-caveat"
            >
              <div className="text-sm font-semibold text-stone-800">{item.name}</div>
              {item.address.length > 0 && (
                <div className="text-xs text-stone-400 truncate">{item.address}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}