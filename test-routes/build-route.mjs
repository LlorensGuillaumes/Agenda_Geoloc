/**
 * Genera test-routes/full-trip.gpx amb timestamps perquè Lockito respecti
 * les velocitats de cada tram (autopista 120 km/h, urbà 40, caminant 5,
 * estàtic 10 min a casa).
 */
import { writeFileSync } from 'node:fs';

const SEGMENTS = [
  {
    name: 'Autopista 120 km/h',
    kmh: 120,
    points: [
      [41.3097584357563, 1.6232815460490715],
      [41.31600, 1.63800],
      [41.32100, 1.65200],
      [41.32500, 1.66500],
      [41.3278123206696, 1.6751040472771515],
    ],
  },
  {
    name: 'Sortida Tarragona → Párking (urbà 40 km/h)',
    kmh: 40,
    points: [
      [41.3278123206696, 1.6751040472771515],
      [41.33200, 1.68400],
      [41.33800, 1.69200],
      [41.34200, 1.69800],
      [41.34500, 1.70200],
      [41.346424864002984, 1.704254488764633],
    ],
  },
  {
    name: 'Párking → Casa (caminant 5 km/h)',
    kmh: 5,
    points: [
      [41.346424864002984, 1.704254488764633],
      [41.34700, 1.70395],
      [41.34770, 1.70325],
      [41.3481472, 1.7030276],
    ],
  },
  {
    name: 'Estada a Casa 10 min',
    kmh: 0,
    durationSeconds: 600,
    points: [[41.3481472, 1.7030276]],
  },
  {
    name: 'Casa → Institut Pingu (caminant 5 km/h)',
    kmh: 5,
    points: [
      [41.3481472, 1.7030276],
      [41.34730, 1.70020],
      [41.34600, 1.69720],
      [41.34430, 1.69500],
      [41.34250, 1.69370],
      [41.34030350287478, 1.69236767216356],
    ],
  },
];

function haversine([lat1, lon1], [lat2, lon2]) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let t = new Date('2026-05-15T10:00:00Z').getTime();
const trkpts = [];
for (const seg of SEGMENTS) {
  if (seg.kmh === 0) {
    // Tram estàtic: repeteix el punt diverses vegades per cobrir la durada.
    const samples = Math.ceil(seg.durationSeconds / 30);
    const stepMs = (seg.durationSeconds * 1000) / samples;
    for (let i = 0; i < samples; i++) {
      const [lat, lon] = seg.points[0];
      trkpts.push({ lat, lon, time: new Date(t).toISOString() });
      t += stepMs;
    }
    continue;
  }
  const speedMs = (seg.kmh * 1000) / 3600;
  // Inicial del tram = final de l'anterior (no dupliquem timestamp)
  const startIdx = trkpts.length === 0 ? 0 : 1;
  for (let i = startIdx; i < seg.points.length; i++) {
    const prev = seg.points[i - 1] ?? seg.points[i];
    const cur = seg.points[i];
    if (i > 0) {
      const dist = haversine(prev, cur);
      const dtMs = (dist / speedMs) * 1000;
      t += dtMs;
    }
    trkpts.push({ lat: cur[0], lon: cur[1], time: new Date(t).toISOString() });
  }
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Agenda Test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Ruta completa Vilafranca</name>
    <desc>Autopista 120 → sortida Tarragona → Párking (urbà 40) → caminar a Casa → estada 10 min → caminar a Institut Pingu</desc>
  </metadata>
  <trk>
    <name>Full trip</name>
    <trkseg>
${trkpts
  .map(
    (p) =>
      `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><time>${p.time}</time></trkpt>`,
  )
  .join('\n')}
    </trkseg>
  </trk>
</gpx>
`;

writeFileSync('full-trip.gpx', xml);
console.log(`Escrit full-trip.gpx amb ${trkpts.length} punts.`);
console.log(`Durada total: ${((t - new Date('2026-05-15T10:00:00Z').getTime()) / 60000).toFixed(1)} min`);
