// Place names written on the map. Continents and oceans show from afar; seas
// appear as the camera closes in on a chokepoint. Country names are not listed
// here: they come with the country outlines (see geo.js).
//
// Each entry: [text, longitude, latitude, kind]
//   continent, ocean  shown in the world view
//   sea               shown close in

/** Natural Earth's country names, where a shorter or more current one reads better. */
export const COUNTRY_NAMES = {
  'United States of America': 'United States',
  'United Arab Emirates': 'U.A.E.',
  'Dem. Rep. Congo': 'D.R. Congo',
  'Turkey': 'T\u00fcrkiye',
  'Macedonia': 'North Macedonia',
  'eSwatini': 'Eswatini',
};

export const MAP_LABELS = [
  ['North America', -101, 44, 'continent'],
  ['South America', -58, -12, 'continent'],
  ['Europe', 16, 50, 'continent'],
  ['Africa', 20, 9, 'continent'],
  ['Asia', 88, 44, 'continent'],
  ['Australia', 134, -25, 'continent'],
  ['Atlantic Ocean', -36, 26, 'ocean'],
  ['Indian Ocean', 77, -17, 'ocean'],
  ['Pacific Ocean', -132, 14, 'ocean'],
  ['Pacific Ocean', 158, 16, 'ocean'],

  // Suez
  ['Mediterranean Sea', 26.5, 34.2, 'sea'],
  ['Red Sea', 37.6, 21.4, 'sea'],

  // Hormuz
  ['Persian Gulf', 51.6, 27.3, 'sea'],
  ['Gulf of Oman', 59.8, 24.4, 'sea'],
  ['Arabian Sea', 63.5, 16.5, 'sea'],

  // Bab el-Mandeb
  ['Gulf of Aden', 47.6, 13.2, 'sea'],

  // Panama
  ['Caribbean Sea', -76.5, 14.6, 'sea'],
  ['Gulf of Mexico', -90.5, 25, 'sea'],

  // Malacca
  ['Strait of Malacca', 98.9, 4.9, 'sea'],
  ['South China Sea', 112.5, 11.5, 'sea'],
  ['Java Sea', 111, -5, 'sea'],

  // Cape of Good Hope
];
