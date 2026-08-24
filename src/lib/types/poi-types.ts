export type PoiCategory = 'attraction' | 'restaurant';

export interface PoiItem {
  id: string;
  name: string;
  category: PoiCategory;
  latitude: number;
  longitude: number;
  address: string;
  cityName: string;
  districtName: string;
  provinceName: string;
  adcode: string;
  rating: number;
  cost: number;
  openingTime: string;
  openingTimeToday: string;
  openingTimeWeek: string;
  telephone: string;
  tags: string[];
  typeLabel: string;
  typeCode: string;
  photoUrls: string[];
  businessArea: string;
  website: string;
  email: string;
  distance: number;
  alias: string;
  /** ID of the attraction this POI is near (for proximity-based restaurant search) */
  proximityGroupId?: string;
  /** Name of the attraction this POI is near */
  proximityGroupName?: string;
}

export interface AttractionPoi extends PoiItem {
  category: 'attraction';
}

export interface RestaurantPoi extends PoiItem {
  category: 'restaurant';
  recommendedDishes: string[];
}

export function isRestaurantPoi(poi: PoiItem): poi is RestaurantPoi {
  return poi.category === 'restaurant';
}

export function isAttractionPoi(poi: PoiItem): poi is AttractionPoi {
  return poi.category === 'attraction';
}