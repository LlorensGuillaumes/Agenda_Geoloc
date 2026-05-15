import { forwardRef, useMemo } from 'react';
import { View, type ViewStyle } from 'react-native';
import {
  Map,
  Camera,
  Marker,
  GeoJSONSource,
  Layer,
  UserLocation,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import circle from '@turf/circle';

const TILE_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export type LatLng = { latitude: number; longitude: number };

/**
 * Extrae las coordenadas del evento de tap del mapa. MapLibre RN v11 expone
 * `nativeEvent.lngLat: [lng, lat]`. Mantenemos el lector de `geometry.
 * coordinates` (forma v10) como fallback silencioso por si una versión
 * intermedia o un wrapper futuro vuelve a esa forma.
 */
function extractAndNotify(
  _source: 'tap' | 'long',
  nativeEvent: unknown,
  onPressMap: ((coords: LatLng) => void) | undefined,
): void {
  if (!onPressMap || !nativeEvent || typeof nativeEvent !== 'object') return;
  const ev = nativeEvent as Record<string, unknown>;

  const lngLat = ev.lngLat as [number, number] | undefined;
  if (Array.isArray(lngLat) && lngLat.length >= 2) {
    onPressMap({ longitude: lngLat[0], latitude: lngLat[1] });
    return;
  }

  const geom = ev.geometry as { coordinates?: [number, number] } | undefined;
  if (geom?.coordinates && geom.coordinates.length >= 2) {
    onPressMap({ longitude: geom.coordinates[0], latitude: geom.coordinates[1] });
  }
}

export type GeofenceMapProps = {
  center: LatLng;
  radius: number;
  color?: string;
  initialZoom?: number;
  showUserLocation?: boolean;
  followInitialCenter?: boolean;
  onPressMap?: (coords: LatLng) => void;
  style?: ViewStyle;
};

export const GeofenceMap = forwardRef<CameraRef, GeofenceMapProps>(
  function GeofenceMap(
    {
      center,
      radius,
      color = '#2563EB',
      initialZoom = 14,
      showUserLocation = false,
      followInitialCenter = true,
      onPressMap,
      style,
    },
    cameraRef,
  ) {
    const circleGeoJSON = useMemo(
      () =>
        circle([center.longitude, center.latitude], radius / 1000, {
          steps: 64,
          units: 'kilometers',
        }),
      [center.latitude, center.longitude, radius],
    );

    return (
      <View style={[{ flex: 1 }, style]}>
        <Map
          style={{ flex: 1 }}
          mapStyle={TILE_STYLE}
          onPress={(e) => extractAndNotify('tap', e?.nativeEvent, onPressMap)}
          onLongPress={(e) => extractAndNotify('long', e?.nativeEvent, onPressMap)}
          attribution
          logo
        >
          {followInitialCenter && (
            <Camera
              ref={cameraRef}
              center={[center.longitude, center.latitude]}
              zoom={initialZoom}
            />
          )}
          {showUserLocation && <UserLocation />}

          <GeoJSONSource id="geofence-circle" data={circleGeoJSON}>
            <Layer
              id="geofence-circle-fill"
              type="fill"
              paint={{ 'fill-color': color, 'fill-opacity': 0.2 }}
            />
            <Layer
              id="geofence-circle-stroke"
              type="line"
              paint={{ 'line-color': color, 'line-width': 2 }}
            />
          </GeoJSONSource>

          <Marker id="geofence-marker" lngLat={[center.longitude, center.latitude]}>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: color,
                borderWidth: 3,
                borderColor: 'white',
              }}
            />
          </Marker>
        </Map>
      </View>
    );
  },
);
