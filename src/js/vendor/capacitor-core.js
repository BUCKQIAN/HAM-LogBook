// Shim for @capacitor/core - uses native Capacitor bridge on Android
const cap = typeof window !== 'undefined' ? (window.Capacitor || {}) : {};
export const registerPlugin = cap.registerPlugin || function(name) {
    return cap.Plugins ? cap.Plugins[name] || {} : {};
};
export const WebPlugin = cap.WebPlugin || class {};
export const Capacitor = cap;
export const ExceptionCode = cap.ExceptionCode || {};
export const CapacitorException = cap.Exception || Error;
export const Plugins = cap.Plugins || {};
export default cap;
