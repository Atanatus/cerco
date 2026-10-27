/* CERCO skins adapter — website side only, no network/payment/backend logic.
 * Use only after the ATANATUS backend has verified ownership.
 * Source: CERCO Expedition 0.8.1 / protocol 1 / cerco.skins.v1
 */
(function () {
  'use strict';
  class CercoSkinsAdapter {
    constructor(iframe) {
      if (!(iframe instanceof HTMLIFrameElement)) throw new TypeError('A CERCO iframe is required');
      if (!iframe.src) throw new TypeError('The CERCO iframe must have a real HTTPS src');
      this.frame = iframe;
      this.origin = new URL(iframe.src, location.href).origin;
      if (this.origin === 'null') throw new Error('Use an HTTP(S) game URL, not srcdoc or a file URL');
      this.pending = new Map();
      this.onMessage = this.onMessage.bind(this);
      window.addEventListener('message', this.onMessage);
    }
    onMessage(event) {
      if (event.source !== this.frame.contentWindow || event.origin !== this.origin) return;
      const data = event.data;
      if (!data || data.source !== 'CERCO' || data.protocol !== 1 || typeof data.requestId !== 'string') return;
      const slot = this.pending.get(data.requestId);
      if (!slot) return;
      if (data.event !== slot.expectedEvent) return;
      this.pending.delete(data.requestId);
      clearTimeout(slot.timeoutId);
      slot.resolve(data.detail);
    }
    send(action, extra, expectedEvent) {
      if (!this.frame.contentWindow) return Promise.reject(new Error('CERCO iframe is not loaded'));
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.pending.delete(requestId);
          reject(new Error('CERCO skin request timed out'));
        }, 7000);
        this.pending.set(requestId, { resolve, reject, timeoutId, expectedEvent });
        this.frame.contentWindow.postMessage({source:'ATANATUS', protocol:1, action, requestId, ...extra}, this.origin);
      });
    }
    async catalog() { return this.send('cerco_query', {query:'skin_catalog'}, 'query_result'); }
    async equipped() { return this.send('cerco_query', {query:'skin_state'}, 'query_result'); }
    async preview(skinId, size=256) {
      return this.send('cerco_query', {query:'skin_preview', skinId, size}, 'query_result');
    }
    async equip(verifiedOwnedSkinId) {
      // The CALLER must verify ownership on its own server before invoking this method.
      const result = await this.send('cerco_set_skin', {skinId:verifiedOwnedSkinId}, 'skin_set_result');
      if (!result || !result.ok) throw new Error(result?.error || 'CERCO rejected this skin');
      return result;
    }
    destroy() {
      window.removeEventListener('message', this.onMessage);
      for (const slot of this.pending.values()) {
        clearTimeout(slot.timeoutId);
        slot.reject(new Error('CERCO skins adapter destroyed'));
      }
      this.pending.clear();
    }
  }
  window.CercoSkinsAdapter = CercoSkinsAdapter;
})();
