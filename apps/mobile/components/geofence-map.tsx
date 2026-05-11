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
          onPress={(e) => {
            const coords = (e.nativeEvent as { geometry?: { coordinates?: [number, number] } })
              .geometry?.coordinates;
            if (!coords || !onPressMap) return;
            onPressMap({ longitude: coords[0], latitude: coords[1] });
          }}
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
