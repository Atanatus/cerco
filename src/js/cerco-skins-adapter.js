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
      if (this.origin !== location.origin || !/^https?:/.test(new URL(iframe.src, location.href).protocol)) {
        throw new Error('A same-origin CERCO frame is required');
      }
      this.pending = new Map();
      this.onMessage = this.onMessage.bind(this);
      this.onLoad = () => this.cancelPending('CERCO frame reloaded');
      window.addEventListener('message', this.onMessage);
      iframe.addEventListener('load', this.onLoad);
    }
    onMessage(event) {
      if (event.source !== this.frame.contentWindow || event.origin !== this.origin) return;
      const data = event.data;
      if (!data || data.source !== 'CERCO' || data.protocol !== 1 || typeof data.requestId !== 'string') return;
      const slot = this.pending.get(data.requestId);
      if (!slot) return;
      try {
        if (!data.detail || typeof data.detail !== 'object' || Array.isArray(data.detail) ||
            JSON.stringify(data.detail).length > 600000) return;
      } catch (_) { return; }
      if (data.event !== slot.expectedEvent) return;
      if (slot.query && data.query !== slot.query) return;
      this.pending.delete(data.requestId);
      clearTimeout(slot.timeoutId);
      slot.resolve(data.detail);
    }
    send(action, extra, expectedEvent) {
      if (!this.frame.contentWindow) return Promise.reject(new Error('CERCO iframe is not loaded'));
      if (this.pending.size >= 16) return Promise.reject(new Error('Too many pending skin requests'));
      if (new URL(this.frame.src, location.href).origin !== this.origin) return Promise.reject(new Error('CERCO destination changed'));
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.pending.delete(requestId);
          reject(new Error('CERCO skin request timed out'));
        }, 7000);
        this.pending.set(requestId, { resolve, reject, timeoutId, expectedEvent, query: extra.query });
        try {
          this.frame.contentWindow.postMessage({source:'ATANATUS', protocol:1, action, requestId, ...extra}, this.origin);
        } catch (error) {
          this.pending.delete(requestId); clearTimeout(timeoutId); reject(error);
        }
      });
    }
    async catalog() { return this.send('cerco_query', {query:'skin_catalog'}, 'query_result'); }
    async capabilities() { return this.send('cerco_query', {query:'capabilities'}, 'query_result'); }
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
    cancelPending(reason) {
      for (const slot of this.pending.values()) {
        clearTimeout(slot.timeoutId);
        slot.reject(new Error(reason));
      }
      this.pending.clear();
    }
    destroy() {
      window.removeEventListener('message', this.onMessage);
      this.frame.removeEventListener('load', this.onLoad);
      this.cancelPending('CERCO skins adapter destroyed');
    }
  }
  window.CercoSkinsAdapter = CercoSkinsAdapter;
})();
