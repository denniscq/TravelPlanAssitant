export interface AmapPoiSearchRequest {
  keywords?: string;
  types: string;
  city: string;
  offset: number;
  page: number;
}

export interface AmapPoiSearchResponse {
  status: '0' | '1';
  info: string;
  count: string;
  pois: AmapPoiItem[];
}

export interface AmapPoiItem {
  id: string;
  name: string;
  type: string;
  typecode: string;
  address: string;
  location: string;
  pname: string;
  cityname: string;
  adname: string;
  pcode: string;
  citycode: string;
  adcode: string;
  distance: string;
  parent: string;
  /** Business info fields — returned inside a nested object when show_fields=business is set */
  business?: AmapPoiBusiness;
  photos?: AmapPoiPhoto[];
}

export interface AmapPoiBusiness {
  opentime_today: string;
  opentime_week: string;
  rating: string;
  cost: string;
  business_area: string;
  tel: string;
  /** Category tag (e.g. "广场", "小吃快餐") */
  keytag: string;
  /** Restaurant specialty tag (e.g. "小吃快餐") */
  rectag: string;
  /** Alternative name / alias */
  alias: string;
}

export interface AmapPoiPhoto {
  title: string;
  url: string;
}

export interface AmapDirectionRequest {
  origin: string;
  destination: string;
  waypoints?: string;
  strategy: number;
}

export interface AmapDirectionResponse {
  status: '0' | '1';
  info: string;
  route: AmapRoute;
}

export interface AmapRoute {
  origin: string;
  destination: string;
  distance: string;
  duration: string;
  paths: AmapPath[];
  steps: AmapStep[];
  taxi_cost: string;
}

export interface AmapPath {
  distance: string;
  duration: string;
  strategy: string;
  steps: AmapStep[];
  tolls: string;
  toll_distance: string;
  toll_road: string;
}

export interface AmapStep {
  instruction: string;
  orientation: string;
  road: string;
  distance: string;
  duration: string;
  polyline: string;
  action: string;
  assistant_action: string;
  tolls: string;
  toll_distance: string;
  toll_road: string;
  navigation: string;
}

export interface AmapWalkingDirectionResponse {
  status: '0' | '1';
  info: string;
  route: {
    origin: string;
    destination: string;
    distance: string;
    duration: string;
    paths: AmapPath[];
  };
}

/**
 * AMap integrated transit (/v3/direction/transit/integrated) response shape.
 *
 * IMPORTANT: The top-level key is `transits` (array), NOT `transit`. Each
 * entry is one possible itinerary. Within an itinerary, `segments[i]` has
 * `walking.steps[].polyline` and `bus.buslines[].polyline` / `subway.steps[].polyline`.
 *
 * Reference: https://lbs.amap.com/api/webservice/guide/api/transit
 */
export interface AmapTransitStep {
  instruction: string;
  road: string;
  distance: string;
  duration: string;
  polyline: string;
  action?: string;
  assistant_action?: string;
}

export interface AmapTransitWalkingSubsegment {
  origin: string;
  destination: string;
  distance: string;
  duration: string;
  steps: AmapTransitStep[];
}

export interface AmapTransitBusPolyline {
  polyline: string;
}

export interface AmapTransitBusline {
  departure_stop: { name: string; id: string; location: string };
  arrival_stop: { name: string; id: string; location: string };
  name: string;
  id: string;
  type: string;
  distance: string;
  duration: string;
  polyline: string;
  via_num?: string;
  via_stops?: { name: string; location: string }[];
}

export interface AmapTransitBusSubsegment {
  buslines: AmapTransitBusline[];
}

export interface AmapTransitSegment {
  walking?: AmapTransitWalkingSubsegment;
  bus?: AmapTransitBusSubsegment;
  /** subway is also possible — same polyline shape as bus. */
  subway?: AmapTransitBusSubsegment;
  /** rail / train segments have similar shape. */
  railway?: { name?: string; trips?: { polyline?: string }[] };
}

export interface AmapTransitItinerary {
  cost: string;
  duration: string;
  nightflag: string;
  walking_distance: string;
  distance: string;
  missed: string;
  segments: AmapTransitSegment[];
}

export interface AmapTransitDirectionResponse {
  status: '0' | '1';
  info: string;
  count?: string;
  route: {
    origin: string;
    destination: string;
    distance: string;
    taxi_cost?: string;
    /** NOTE: real key is `transits` (plural array). */
    transits: AmapTransitItinerary[];
  };
}

export interface AmapCyclingDirectionResponse {
  status: '0' | '1';
  info: string;
  route: {
    origin: string;
    destination: string;
    distance: string;
    duration: string;
    paths: AmapPath[];
  };
}

export type AmapDirectionType = 'driving' | 'walking' | 'transit' | 'cycling';

// ====== IP Location API ======

export interface AmapIpLocationResponse {
  status: string;
  info: string;
  province: string;
  city: string;
  adcode: string;
  rectangle: string;
}

// ====== District API ======

export interface AmapDistrictResponse {
  status: string;
  info: string;
  districts: AmapDistrictItem[];
}

export interface AmapDistrictItem {
  name: string;
  adcode: string;
  center: string;
  level: string;
  districts: AmapDistrictItem[];
}

// ====== Inputtip (Autocomplete) API ======

export interface AmapInputtipResponse {
  status: string;
  info: string;
  count: string;
  tips: AmapInputtipTip[];
}

export interface AmapInputtipTip {
  id: string;
  name: string;
  district: string;
  adcode: string;
  location: string;
  address: string;
  typecode: string;
}

// ====== Around Search (for transit stations) ======

/**
 * Minimal shape we need from AMap around-search for transit stations.
 * Full field list: https://lbs.amap.com/api/webservice/guide/api/newpoisearch
 */
export interface AmapAroundPoiRaw {
  id: string;
  name: string;
  type: string;
  typecode: string;
  address: string;
  location: string;
  distance: string;
}

export interface AmapAroundSearchResponse {
  status: string;
  info: string;
  count: string;
  pois: AmapAroundPoiRaw[];
}