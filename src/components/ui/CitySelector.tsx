'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface CityInfo {
  name: string;
  adcode: string;
  center: [number, number];
}

interface DistrictTreeNode {
  label: string;
  value: string;
  adcode: string;
  center: [number, number];
  children?: DistrictTreeNode[];
}

interface CitySelectorProps {
  currentCity: CityInfo;
  onCityChange: (city: CityInfo) => void;
  readOnly?: boolean;
}

/** Custom dropdown that supports font-caveat (native select ignores font on <option>) */
function CustomSelect({
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  value: string;
  options: DistrictTreeNode[];
  placeholder: string;
  disabled?: boolean;
  onChange: (adcode: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectedLabel = options.find((o) => o.adcode === value)?.label ?? '';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="pencil-input w-full text-sm font-caveat text-left"
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen(!open); }}
      >
        <span className="flex items-center justify-between">
          <span>{selectedLabel || placeholder}</span>
          <span className="ml-2 text-xs text-stone-400">{open ? '▲' : '▼'}</span>
        </span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full border-2 border-stone-400 bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)] max-h-48 overflow-y-auto">
          {options.map((opt) => (
            <button
              key={opt.adcode}
              type="button"
              className="w-full border-b border-stone-200 px-3 py-2 text-left text-sm font-caveat hover:bg-stone-100 last:border-b-0"
              onClick={() => {
                onChange(opt.adcode);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CitySelector({ currentCity, onCityChange, readOnly = false }: CitySelectorProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [tree, setTree] = useState<DistrictTreeNode[]>([]);
  const [province, setProvince] = useState<DistrictTreeNode | null>(null);
  const [city, setCity] = useState<DistrictTreeNode | null>(null);
  const [district, setDistrict] = useState<DistrictTreeNode | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load district tree on mount
  useEffect(() => {
    const loadTree = async () => {
      try {
        const response = await fetch('/api/amap/district');
        const result = await response.json();
        if (result.success) {
          setTree(result.data as DistrictTreeNode[]);
        }
      } catch (err) {
        console.error('Failed to load district tree:', err);
      }
    };
    loadTree();
  }, []);

  const handleConfirm = useCallback(() => {
    // Pick the deepest selected level
    const target = district ?? city ?? province;
    if (target) {
      onCityChange({
        name: target.label,
        adcode: target.adcode,
        center: target.center,
      });
      setOpen(false);
      // Reset cascade
      setProvince(null);
      setCity(null);
      setDistrict(null);
    }
  }, [district, city, province, onCityChange]);

  const handleCancel = useCallback(() => {
    setOpen(false);
    setProvince(null);
    setCity(null);
    setDistrict(null);
  }, []);

  const handleProvinceChange = useCallback((adcode: string) => {
    const selected = tree.find((p) => p.adcode === adcode);
    setProvince(selected ?? null);
    setCity(null);
    setDistrict(null);
  }, [tree]);

  const handleCityChange = useCallback((adcode: string) => {
    const selected = province?.children?.find((c) => c.adcode === adcode);
    setCity(selected ?? null);
    setDistrict(null);
  }, [province]);

  const handleDistrictChange = useCallback((adcode: string) => {
    const selected = city?.children?.find((d) => d.adcode === adcode);
    setDistrict(selected ?? null);
  }, [city]);

  return (
    <div className="relative inline-flex items-center gap-2">
      <span className="pencil-label text-base">{currentCity.name}</span>
      {!readOnly && (
        <button
          type="button"
          className="pencil-btn text-xs px-2 py-1"
          onClick={() => setOpen(!open)}
        >
          切换
        </button>
      )}

      {open && mounted && createPortal(
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-[9999] bg-black/20" onClick={handleCancel} />
          {/* Popup */}
          <div className="fixed left-1/2 top-[15%] z-[10000] w-80 -translate-x-1/2 bg-white border-2 border-stone-400 p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)]">
            <p className="pencil-label mb-3 text-sm">选择目标城市</p>

            {/* Province */}
            <div className="mb-2">
              <label className="mb-1 block text-xs font-semibold text-stone-600 font-caveat">省份</label>
              <CustomSelect
                value={province?.adcode ?? ''}
                options={tree}
                placeholder="请选择省份"
                onChange={handleProvinceChange}
              />
            </div>

            {/* City */}
            <div className="mb-2">
              <label className="mb-1 block text-xs font-semibold text-stone-600 font-caveat">城市</label>
              <CustomSelect
                value={city?.adcode ?? ''}
                options={province?.children ?? []}
                placeholder="请选择城市"
                disabled={!province}
                onChange={handleCityChange}
              />
            </div>

            {/* District */}
            <div className="mb-4">
              <label className="mb-1 block text-xs font-semibold text-stone-600 font-caveat">区/县</label>
              <CustomSelect
                value={district?.adcode ?? ''}
                options={city?.children ?? []}
                placeholder="请选择区/县（可选）"
                disabled={!city}
                onChange={handleDistrictChange}
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="pencil-btn flex-1 text-xs"
                onClick={handleCancel}
              >
                取消
              </button>
              <button
                type="button"
                className="pencil-btn-primary flex-1 text-xs"
                disabled={!province}
                onClick={handleConfirm}
              >
                确认切换
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}