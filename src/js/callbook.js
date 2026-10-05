import { queryCallsign as queryHamQth, testHamQthConnection } from './hamqth.js';
import { queryQrzCallsign, testQrzConnection } from './qrz.js';

export const CALLBOOK_PROVIDER_KEY = 'hamlog_callbook_provider';
export function getCallbookProvider() {
  return localStorage.getItem(CALLBOOK_PROVIDER_KEY) === 'qrz' ? 'qrz' : 'hamqth';
}
export function getCallbookLabel() { return getCallbookProvider() === 'qrz' ? 'QRZ' : 'HamQTH'; }
export function queryCallsign(callsign) {
  return getCallbookProvider() === 'qrz' ? queryQrzCallsign(callsign) : queryHamQth(callsign);
}
export function testCallbookConnection(provider) {
  return provider === 'qrz' ? testQrzConnection() : testHamQthConnection();
}
