// Place names written on the map. Continents and oceans show from afar;
// countries and seas appear as the camera closes in on a chokepoint.
//
// Each entry: [text, longitude, latitude, kind]
//   continent, ocean  shown in the world view
//   country, sea      shown close in

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
  ['Egypt', 29.3, 26.6, 'country'],
  ['Libya', 18, 27.5, 'country'],
  ['Sudan', 30.5, 16.5, 'country'],
  ['Israel', 34.85, 31.2, 'country'],
  ['Jordan', 36.9, 30.9, 'country'],
  ['Türkiye', 33, 38.9, 'country'],
  ['Mediterranean Sea', 26.5, 34.2, 'sea'],
  ['Red Sea', 37.6, 21.4, 'sea'],

  // Hormuz
  ['Iran', 55, 31, 'country'],
  ['Iraq', 43.6, 33, 'country'],
  ['Kuwait', 47.6, 29.4, 'country'],
  ['Saudi Arabia', 45, 24, 'country'],
  ['Qatar', 51.2, 25.3, 'country'],
  ['U.A.E.', 54.3, 23.7, 'country'],
  ['Oman', 57.3, 21.5, 'country'],
  ['Pakistan', 66.5, 28.5, 'country'],
  ['India', 78.5, 22, 'country'],
  ['Persian Gulf', 51.6, 27.3, 'sea'],
  ['Gulf of Oman', 59.8, 24.4, 'sea'],
  ['Arabian Sea', 63.5, 16.5, 'sea'],

  // Bab el-Mandeb
  ['Yemen', 47.5, 15.7, 'country'],
  ['Eritrea', 38.6, 16.1, 'country'],
  ['Djibouti', 42.4, 11.6, 'country'],
  ['Ethiopia', 39.6, 8.8, 'country'],
  ['Somalia', 46.2, 5.2, 'country'],
  ['Gulf of Aden', 48, 12.6, 'sea'],

  // Panama
  ['Panama', -80.9, 8.55, 'country'],
  ['Costa Rica', -84.1, 10.1, 'country'],
  ['Nicaragua', -85.2, 12.9, 'country'],
  ['Colombia', -73.8, 4.6, 'country'],
  ['Venezuela', -66.2, 7.2, 'country'],
  ['Cuba', -78.8, 21.9, 'country'],
  ['Caribbean Sea', -76.5, 14.6, 'sea'],
  ['Gulf of Mexico', -90.5, 25, 'sea'],

  // Malacca
  ['Malaysia', 102.3, 4.4, 'country'],
  ['Singapore', 104.6, 1.0, 'country'],
  ['Indonesia', 101.6, -0.7, 'country'],
  ['Thailand', 101.2, 15.3, 'country'],
  ['Vietnam', 106.3, 16.2, 'country'],
  ['Borneo', 114, 0.8, 'country'],
  ['Strait of Malacca', 98.9, 4.9, 'sea'],
  ['South China Sea', 112.5, 11.5, 'sea'],
  ['Java Sea', 111, -5, 'sea'],

  // Cape of Good Hope
  ['South Africa', 24.5, -29.6, 'country'],
  ['Namibia', 17.6, -22, 'country'],
  ['Botswana', 24, -22.2, 'country'],
  ['Mozambique', 35.3, -17.6, 'country'],
  ['Madagascar', 46.7, -19.5, 'country'],
];
