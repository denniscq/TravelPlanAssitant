declare namespace AMap {
  class Map {
    constructor(container: HTMLElement, options?: MapOptions);
    destroy(): void;
    setCenter(center: [number, number]): void;
    setZoom(zoom: number): void;
    setFitView(overlays?: unknown[], immediately?: boolean, padding?: number[]): void;
    addControl(control: unknown): void;
    removeControl(control: unknown): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
    off(event: string, handler: (...args: unknown[]) => void): void;
    getCenter(): LngLat;
    getZoom(): number;
    getBounds(): Bounds;
    getContainer(): HTMLElement;
    getLayers(): TileLayer[];
    addLayer(layer: TileLayer): void;
    removeLayer(layer: TileLayer): void;
    plugin(plugins: string | string[], callback: () => void): void;
    clearMap(): void;
    getAllOverlays(type?: string): Overlay[];
    removeOverlays(overlays: Overlay[]): void;
  }

  interface MapOptions {
    center?: [number, number];
    zoom?: number;
    layers?: TileLayer[];
    mapStyle?: string;
    resizeEnable?: boolean;
    viewMode?: string;
    zoomEnable?: boolean;
    dragEnable?: boolean;
  }

  class TileLayer {
    constructor(options?: Record<string, unknown>);
  }

  class Marker {
    constructor(options?: MarkerOptions);
    setMap(map: Map | null): void;
    getPosition(): LngLat;
    setPosition(position: [number, number]): void;
    setLabel(label: Label | undefined): void;
    setTitle(title: string): void;
    setContent(content: string | HTMLElement): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
    off(event: string, handler: (...args: unknown[]) => void): void;
    openInfoWindow(infoWindow: InfoWindow): void;
    getInstance(): Marker;
  }

  interface MarkerOptions {
    position?: [number, number];
    map?: Map;
    title?: string;
    label?: Label;
    content?: string | HTMLElement;
    offset?: Pixel;
    icon?: string | Icon;
    draggable?: boolean;
    zIndex?: number;
    bubble?: boolean;
  }

  interface Label {
    content: string;
    offset?: Pixel;
    direction?: string;
  }

  class InfoWindow {
    constructor(options?: InfoWindowOptions);
    open(map: Map, position: LngLat): void;
    close(): void;
    setContent(content: string | HTMLElement): void;
    setPosition(position: LngLat): void;
    getContent(): string | HTMLElement;
    getPosition(): LngLat;
  }

  interface InfoWindowOptions {
    content?: string | HTMLElement;
    offset?: Pixel;
    closeWhenClickMap?: boolean;
    size?: {
      width: number;
      height: number;
    };
    position?: LngLat;
  }

  class Polyline {
    constructor(options?: PolylineOptions);
    setMap(map: Map | null): void;
    setPath(path: Array<[number, number]>): void;
    setOptions(options: PolylineOptions): void;
    getPath(): Array<[number, number]>;
    getInstance(): Polyline;
  }

  interface PolylineOptions {
    path?: Array<[number, number]>;
    strokeColor?: string;
    strokeWeight?: number;
    strokeOpacity?: number;
    lineJoin?: string;
    lineCap?: string;
    strokeStyle?: string;
    map?: Map;
    zIndex?: number;
    bubble?: boolean;
  }

  class Pixel {
    constructor(x: number, y: number);
    getX(): number;
    getY(): number;
  }

  class LngLat {
    constructor(lng: number, lat: number);
    getLng(): number;
    getLat(): number;
    offset(w: number, s: number): LngLat;
    distance(lnglat: LngLat): number;
    equals(lnglat: LngLat): boolean;
  }

  class Bounds {
    constructor(minLng?: number, minLat?: number, maxLng?: number, maxLat?: number);
    extend(lnglat: LngLat): void;
    contains(lnglat: LngLat): boolean;
    getCenter(): LngLat;
    getSouthWest(): LngLat;
    getNorthEast(): LngLat;
  }

  class Icon {
    constructor(options?: IconOptions);
  }

  interface IconOptions {
    size?: Pixel;
    image?: string;
    imageSize?: Pixel;
    imageOffset?: Pixel;
  }

  type Overlay = Marker | Polyline | InfoWindow;

  namespace Event {
    function addListener(instance: unknown, eventName: string, handler: (...args: unknown[]) => void): unknown;
    function removeListener(listener: unknown): void;
  }
}