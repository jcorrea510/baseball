// How speeds and distances are written on screen: miles per hour and feet (the default), or kilometres per hour and metres
// (Settings -> Units). Picture only - the game itself always counts in mph and feet.
let metric = false;
export function setUnits(u) { metric = u === 'metric'; }
export const isMetric = () => metric;
export const speedValue = (mph) => Math.round(metric ? mph * 1.609344 : mph);
export const speedUnit = () => (metric ? 'km/h' : 'mph');
export const speedText = (mph) => `${speedValue(mph)} ${speedUnit()}`;
export const distValue = (ft) => Math.round(metric ? ft * 0.3048 : ft);
export const distUnit = () => (metric ? 'm' : 'ft');
export const distText = (ft) => `${distValue(ft)} ${distUnit()}`;
