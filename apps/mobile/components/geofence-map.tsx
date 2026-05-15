import { forwardRef, useMemo } from 'react';
import { Alert, View, type ViewStyle } from 'react-native';
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
 * Extrae las coordenadas del evento de tap del mapa probando los paths
 * conocidos según la versión de MapLibre RN (v10 expone
 * `geometry.coordinates`, v11 `lngLat`). Si no encuentra nada, lanza un
 * Alert con un volcado del payload para diagnosticar — la idea es que
 * podamos quitar este branch en cuanto sepamos qué forma llega de verdad.
 */
function extractAndNotify(
  source: 'tap' | 'long',
  nativeEvent: unknown,
  onPressMap: ((coords: LatLng) => void) | undefined,
): void {
  if (!onPressMap) return;
  if (!nativeEvent || typeof nativeEvent !== 'object') {
    Alert.alert('[map debug]', `${source}: nativeEvent vacío`);
    return;
  }
  const ev = nativeEvent as Record<string, unknown>;

  // v11: `lngLat: [longitude, latitude]`
  const lngLat = ev.lngLat as [number, number] | undefined;
  if (Array.isArray(lngLat) && lngLat.length >= 2) {
    onPressMap({ longitude: lngLat[0], latitude: lngLat[1] });
    return;
  }

  // v10: `geometry.coordinates: [longitude, latitude]`
  const geom = ev.geometry as { coordinates?: [number, number] } | undefined;
  if (geom?.coordinates && geom.coordinates.length >= 2) {
    onPressMap({ longitude: geom.coordinates[0], latitude: geom.coordinates[1] });
    return;
  }

  // `coordinate: { latitude, longitude }` (otros wrappers)
  const coordinate = ev.coordinate as
    | { latitude?: number; longitude?: number }
    | undefined;
  if (
    coordinate &&
    typeof coordinate.latitude === 'number' &&
    typeof coordinate.longitude === 'number'
  ) {
    onPressMap({
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
    });
    return;
  }

  // Si no entra en ningún path, volcamos las claves del payload para
  // diagnosticar. Eliminar este Alert una vez sepamos la forma real.
  Alert.alert(
    '[map debug]',
    `${source}: no se han encontrado coords.\n` +
      `keys: ${Object.keys(ev).join(', ') || '(ninguna)'}\n` +
      `payload: ${JSON.stringify(ev).slice(0, 300)}`,
  );
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
