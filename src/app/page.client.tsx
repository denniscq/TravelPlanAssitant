'use client';

import { useState, useCallback, useEffect } from 'react';
import { PoiItem } from '../lib/types/poi-types';
import { StepBar } from '../components/ui/StepBar';
import { StepStartEnd } from '../components/steps/StepStartEnd';
import type { DayRouteData } from '../components/steps/StepStartEnd';
import { StepAttractions } from '../components/steps/StepAttractions';
import { StepRestaurants } from '../components/steps/StepRestaurants';
import { StepRoutePlan } from '../components/steps/StepRoutePlan';
import CitySelector from '../components/ui/CitySelector';
import type { CityInfo } from '../components/ui/CitySelector';
import { PageSkeleton } from '../components/ui/PageSkeleton';
import { getClientLogger } from '../lib/utils/client-logger';

const STEP_LABELS = ['起终点', '景点', '餐厅', '路线规划'];

export default function HomePageClient(): React.ReactElement {
  const [currentStep, setCurrentStep] = useState(1);
  const [isInitializing, setIsInitializing] = useState(true);

  const [currentCity, setCurrentCity] = useState<CityInfo | null>(null);
  const [dayRoutes, setDayRoutes] = useState<DayRouteData[] | null>(null);
  const [selectedAttractions, setSelectedAttractions] = useState<PoiItem[]>([]);
  const [selectedRestaurants, setSelectedRestaurants] = useState<PoiItem[]>([]);

  const logger = getClientLogger();

  // Detect IP-based city on mount using AMap Geolocation (reliable in China)
  useEffect(() => {
    let cancelled = false;

    const detectCity = async () => {
      try {
        // Dynamic import to avoid bundling browser-only module at build time
        const { detectCurrentCity } = await import('../lib/utils/amap-js-api-loader');
        const detected = await detectCurrentCity();
        if (cancelled) return;

        if (detected !== null) {
          setCurrentCity(detected);
          logger.info('City detected via AMap Geolocation - ' + detected.name);
          return;
        }

        // AMap Geolocation failed — try server-side IP API as fallback
        logger.warn('AMap Geolocation returned no city, trying server-side IP API');
        const response = await fetch('/api/amap/ip-location');
        const result = await response.json();
        if (cancelled) return;
        if (result.success && result.data.city !== '') {
          const city: CityInfo = {
            name: result.data.city,
            adcode: result.data.adcode,
            center: [116.397428, 39.90923],
          };
          setCurrentCity(city);
          logger.info('IP city detected via server API - ' + city.name);
        } else {
          fallbackToDefault();
        }
      } catch (error) {
        if (cancelled) return;
        logger.error('City detection failed - ' + String(error));
        fallbackToDefault();
      }
    };

    const fallbackToDefault = (): void => {
      if (currentCity !== null) return;
      setCurrentCity({
        name: '北京',
        adcode: '110000',
        center: [116.397428, 39.90923],
      });
    };

    detectCity();

    // Timeout: if IP detection takes > 5s, fall back to default
    const timeoutId = setTimeout(() => {
      if (currentCity === null) {
        logger.warn('IP detection timed out, falling back to default city');
        fallbackToDefault();
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mark initialization complete after city is detected
  useEffect(() => {
    if (currentCity !== null) {
      setIsInitializing(false);
    }
  }, [currentCity]);

  useEffect(() => {
    logger.info('Step changed to ' + currentStep + ' - ' + STEP_LABELS[currentStep - 1]);
  }, [currentStep]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCityChange = useCallback((city: CityInfo): void => {
    logger.info('City changed to ' + city.name + ' (adcode=' + city.adcode + ')');
    setCurrentCity(city);
    // Reset selections when city changes
    setSelectedAttractions([]);
    setSelectedRestaurants([]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStepOneComplete = useCallback((data: { dayRoutes: DayRouteData[] }): void => {
    logger.info('Step 1 completed - ' + data.dayRoutes.length + ' days');
    setDayRoutes(data.dayRoutes);
    setCurrentStep(2);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStepTwoComplete = useCallback(
    (data: { selectedAttractions: PoiItem[] }): void => {
      logger.info('Step 2 completed - selected ' + data.selectedAttractions.length + ' attractions');
      setSelectedAttractions(data.selectedAttractions);
      setCurrentStep(3);
    },
    []
  );

  const handleStepThreeComplete = useCallback(
    (data: { selectedRestaurants: PoiItem[] }): void => {
      logger.info('Step 3 completed - selected ' + data.selectedRestaurants.length + ' restaurants');
      setSelectedRestaurants(data.selectedRestaurants);
      setCurrentStep(4);
    },
    []
  );

  const handleToggleAttraction = useCallback((poi: PoiItem): void => {
    setSelectedAttractions((previous) => {
      const isAlreadySelected = previous.some((item) => item.id === poi.id);
      if (isAlreadySelected) {
        logger.info('Removed attraction - ' + poi.name);
        return previous.filter((item) => item.id !== poi.id);
      }
      logger.info('Added attraction - ' + poi.name + ' (' + poi.id + ')');
      return [...previous, poi];
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleRestaurant = useCallback((poi: PoiItem): void => {
    setSelectedRestaurants((previous) => {
      const isAlreadySelected = previous.some((item) => item.id === poi.id);
      if (isAlreadySelected) {
        logger.info('Removed restaurant - ' + poi.name);
        return previous.filter((item) => item.id !== poi.id);
      }
      logger.info('Added restaurant - ' + poi.name + ' (' + poi.id + ')');
      return [...previous, poi];
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGoBack = useCallback((): void => {
    logger.info('Navigated back from step ' + currentStep);
    setCurrentStep((previous) => Math.max(1, previous - 1));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReset = useCallback((): void => {
    logger.info('Reset all plan data');
    setCurrentStep(1);
    setDayRoutes(null);
    setSelectedAttractions([]);
    setSelectedRestaurants([]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (isInitializing) {
    return <PageSkeleton />;
  }

  const isMapStep = currentStep === 2 || currentStep === 3 || currentStep === 4;

  return (
    <div className={'mx-auto w-full max-w-7xl px-2 sm:px-4' + (isMapStep && currentStep !== 4 ? ' flex h-screen flex-col overflow-hidden' : '')}>
      <div className={isMapStep && currentStep !== 4 ? 'shrink-0' : ''}>
        {/* Title and subtitle — hidden on mobile during map steps to save vertical space */}
        <div className={'mb-4 sm:mb-6' + (isMapStep && currentStep !== 4 ? ' hidden lg:block' : '')}>
          <h1 className="pencil-heading text-2xl sm:text-3xl">
            旅行路线规划
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-stone-500 font-caveat">
            四步轻松规划你的完美旅行路线
          </p>
        </div>

        {/* City selector — hidden on mobile during map steps to save vertical space */}
        <div className={'pencil-card mb-4' + (isMapStep && currentStep !== 4 ? ' hidden lg:block' : '')}>
          {currentCity !== null && (
            <CitySelector
              currentCity={currentCity}
              onCityChange={handleCityChange}
              readOnly={currentStep !== 1}
            />
          )}
        </div>

        <StepBar
          currentStep={currentStep}
          totalSteps={4}
          stepLabels={STEP_LABELS}
        />
      </div>

      {isMapStep ? (
        currentStep === 4 ? (
          /* Step 4: natural page scroll to show full content (map + markdown) */
          <div className="pt-1 sm:pt-3">
            {dayRoutes !== null && (
              <StepRoutePlan
                onBack={handleGoBack}
                onReset={handleReset}
                selectedAttractions={selectedAttractions}
                selectedRestaurants={selectedRestaurants}
                dayRoutes={dayRoutes}
                mapCenter={currentCity?.center ?? [116.397428, 39.90923]}
              />
            )}
          </div>
        ) : (
          /* Steps 2 & 3: fill viewport, no scroll */
          <div className="min-h-0 flex-1 flex flex-col pt-1 sm:pt-3">
            {/* Step 2 */}
            {currentStep === 2 && (
              <div className="flex-1 overflow-hidden">
                <StepAttractions
                  onComplete={handleStepTwoComplete}
                  onBack={handleGoBack}
                  selectedAttractions={selectedAttractions}
                  onToggleAttraction={handleToggleAttraction}
                  cityName={currentCity?.name ?? ''}
                  mapCenter={currentCity?.center ?? [116.397428, 39.90923]}
                />
              </div>
            )}

            {/* Step 3 */}
            {currentStep === 3 && (
              <div className="flex-1 overflow-hidden">
                <StepRestaurants
                  onComplete={handleStepThreeComplete}
                  onBack={handleGoBack}
                  selectedRestaurants={selectedRestaurants}
                  onToggleRestaurant={handleToggleRestaurant}
                  cityName={currentCity?.name ?? ''}
                  mapCenter={currentCity?.center ?? [116.397428, 39.90923]}
                  selectedAttractions={selectedAttractions}
                />
              </div>
            )}
          </div>
        )
      ) : (
        /* Step 1: natural page flow, page-level scroll when content overflows */
        <div className="pt-6">
          <div className="pencil-card">
            <StepStartEnd
              onComplete={handleStepOneComplete}
              initialData={
                dayRoutes !== null
                  ? { dayRoutes }
                  : undefined
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}