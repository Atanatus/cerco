/* PROYECTOZ SKINS V066 */
(function () {
    'use strict';

    const panel = document.getElementById('pz-skins');
    const nav = document.querySelector('[data-panel="settings"]');
    const back = document.getElementById('pz-skins-back');
    const shop = document.getElementById('pz-shop');
    const leaderboards = document.getElementById('pz-leaderboards');
    const grid = document.getElementById('pz-skins-grid');
    const empty = document.getElementById('pz-skins-empty');

    if (!panel || !nav || !back || !grid || !empty) {
        console.warn('[SKINS] Required elements missing.');
        return;
    }

    /* ATANATUS NAVIGATION V088 */

    function showSkins() {
        if (shop) shop.hidden = true;
        if (leaderboards) leaderboards.hidden = true;
        panel.hidden = false;
    }

    function hideSkins() {
        panel.hidden = true;
    }

    nav.addEventListener('click', showSkins);
    back.addEventListener('click', hideSkins);

    // Close SKINS before another section's own controller opens it.
    // Capture phase makes the behavior independent of listener order.
    document.querySelectorAll(
        '.player-navigation [data-panel="leaderboard"], ' +
        '.player-navigation [data-panel="shop"]'
    ).forEach(function (button) {
        button.addEventListener('click', function () {
            panel.hidden = true;
        }, true);
    });

    const service = window.CERCO_COSMETICS;
    const frame = document.getElementById('cerco-game-frame');
    const gallery = document.getElementById('pz-shop-skins');
    const summary = document.getElementById('cosmetic-wallet');
    const shopStatus = document.getElementById('cosmetic-shop-status');
    let adapter = null, catalog = null, frameEpoch = 0, busy = false;
    const status = document.createElement('p');
    status.id = 'cerco-skin-status'; status.setAttribute('role', 'status');
    panel.querySelector('.pz-skins-content').appendChild(status);
    function announce(text) { status.textContent = text; shopStatus.textContent = text; }
    async function applySkin(id, instance = adapter) {
        if (!instance) return;
        const result = await instance.equip(id);
        if (result.skinId !== id || result.cosmeticOnly !== true) throw new Error();
    }
    async function equip(skinId) {
        if (busy) return; busy = true; render();
        try {
            const inv = await service.equip(skinId);
            if (inv.equippedSkinId !== skinId || inv.guest_id !== window.CERCO_GUEST_PROFILE.getProfile()?.guestId) throw new Error();
            await applySkin(skinId);
            announce((catalog?.skins.find(s => s.id === skinId)?.name || 'Appearance') +
                (adapter ? ' equipped. Appearance only.' : ' saved. Press PLAY to use it.'));
        } catch (_) { announce('Unable to confirm equipment. Please retry when connected.'); }
        finally { busy = false; render(); }
    }
    async function buy(skinId) {
        if (busy) return; busy = true; render(); announce('Confirming purchase with the server…');
        try { await service.purchase(skinId); announce(service.getState() ? 'Purchase confirmed. Your inventory is updated.' : 'Purchase confirmed. Balance refresh unavailable; please refresh.'); }
        catch (_) { announce('Purchase unconfirmed. Refresh or retry; the same order is protected against duplicate charges.'); void refresh(false); }
        finally { busy = false; render(); }
    }
    function card(skin) {
        const state = service.getState(), inv = state?.inventory;
        const product = state?.products.find(p => p.product_id === skin.id);
        const owned = inv?.ownedSkinIds.includes(skin.id) || skin.id === 'cerco.default';
        const item = document.createElement('article'); item.className = 'cerco-skin-card'; item.dataset.productId = skin.id;
        const image = document.createElement('img'); image.src = './assets/skins/cerco/' + skin.previewAsset;
        image.alt = skin.name + ' official preview'; image.width = 160; image.height = 160;
        const name = document.createElement('h4'); name.textContent = skin.name;
        const description = document.createElement('p'); description.textContent = skin.description;
        const price = document.createElement('p'); price.className = 'cosmetic-price';
        price.textContent = product ? (product.free ? 'FREE' : product.price.toLocaleString('en-US') + ' ✦') + (owned ? ' · OWNED' : '') : 'Price unavailable';
        const button = document.createElement('button'); button.type = 'button';
        if (owned) {
            button.textContent = inv?.equippedSkinId === skin.id ? (skin.id === 'cerco.default' ? 'Equipped · free' : 'EQUIPPED') : 'EQUIP';
            button.setAttribute('aria-pressed', String(inv?.equippedSkinId === skin.id));
            button.addEventListener('click', () => { void equip(skin.id); });
            button.disabled = busy || service.getStatus() !== 'ready' || !state || !product?.active;
        } else {
            button.textContent = !state || !product?.active ? 'UNAVAILABLE' : inv.wallet.balance < product.price ? 'INSUFFICIENT FUNDS' : 'BUY';
            button.disabled = busy || service.getStatus() !== 'ready' || button.textContent !== 'BUY';
            button.addEventListener('click', () => { void buy(skin.id); });
        }
        item.append(image, name, description, price, button);
        if (adapter) {
            const preview = document.createElement('button'); preview.type = 'button'; preview.textContent = 'Preview';
            preview.addEventListener('click', async () => {
                try {
                    const p = await adapter.preview(skin.id, 256);
                    if (p.skinId === skin.id && p.mimeType === 'image/png' && typeof p.dataUrl === 'string' &&
                        p.dataUrl.length < 500000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(p.dataUrl)) image.src = p.dataUrl;
                } catch (_) { announce('Live preview unavailable. Showing the official thumbnail.'); }
            }); item.appendChild(preview);
        }
        return item;
    }
    function renderPictures(inv) {
        const target = document.querySelector('.pz-avatar-gallery');
        if (!target) return;
        target.querySelectorAll('[data-cosmetic-picture]').forEach(n => n.remove());
        const pictures = (inv?.items || []).filter(i => i.category === 'profile_picture' && i.active &&
            /^\/assets\/profile-pictures\/[A-Za-z0-9_-]+\.(png|webp)$/.test(i.asset_path));
        for (const picture of pictures) {
            const button = document.createElement('button'); button.type = 'button'; button.dataset.cosmeticPicture = picture.product_id;
            const image = document.createElement('img'); image.src = picture.asset_path; image.alt = picture.name; image.width = 96; image.height = 96;
            button.append(image); button.setAttribute('aria-label', 'Equip ' + picture.name);
            button.setAttribute('aria-pressed', String(picture.product_id === inv.equippedPictureId));
            button.disabled = busy;
            button.addEventListener('click', async () => {
                if (busy) return; busy = true; render();
                try { await service.equip(picture.product_id, 'profile_picture'); announce('Profile picture saved.'); }
                catch (_) { announce('Picture equipment unconfirmed.'); }
                finally { busy = false; render(); }
            }); target.append(button);
        }
        const placeholder = target.querySelector('.pz-avatar-empty'); if (placeholder) placeholder.hidden = pictures.length > 0;
        const avatar = document.querySelector('.player-avatar');
        if (!avatar) return;
        let image = avatar.querySelector('img[data-equipped-picture]');
        const picture = pictures.find(p => p.product_id === inv?.equippedPictureId);
        if (picture && !avatar.querySelector('img:not([data-equipped-picture])')) { if (!image) { image = document.createElement('img'); image.dataset.equippedPicture = ''; avatar.prepend(image); }
            image.src = picture.asset_path; image.alt = picture.name;
        } else if (image) image.remove();
    }
    function render() {
        const state = service.getState(), inv = state?.inventory;
        summary.textContent = service.getStatus() === 'loading' ? 'Loading balance…' : inv ? inv.wallet.balance.toLocaleString('en-US') + ' ✦ confirmed · ' +
            inv.wallet.pending.toLocaleString('en-US') + ' ✦ pending (not spendable)' : 'Balance unavailable. Please retry.';
        document.getElementById('cosmetic-picture-price').textContent = state ?
            (state.categories.find(c=>c.category==='profile_picture')?.price.toLocaleString('en-US') || '—') + ' ✦ · COMING SOON' : 'COMING SOON';
        if (!catalog) return;
        // Keep focus on the same action across refreshes and purchase transitions.
        const focus = document.activeElement, productId = focus?.closest('[data-product-id]')?.dataset.productId;
        const container = focus?.closest('#pz-shop-skins, #pz-skins-grid')?.id;
        const preview = focus?.textContent === 'Preview';
        gallery.replaceChildren(...catalog.skins.map(skin => card(skin)));
        grid.replaceChildren(...catalog.skins.filter(skin => skin.id === 'cerco.default' || inv?.ownedSkinIds.includes(skin.id)).map(skin => card(skin)));
        if (productId && container) {
            const node = [...document.getElementById(container).children].find(n=>n.dataset.productId===productId);
            const button = node?.querySelectorAll('button')[preview ? 1 : 0];
            if (button && !button.disabled) button.focus({preventScroll:true});
        }
        empty.hidden = true; renderPictures(inv);
    }
    async function refresh(announceReady = true) {
        try { await service.refresh(); if (announceReady) announce('Server inventory updated. Appearance only.'); }
        catch (_) { if (announceReady) announce('Cosmetics service unavailable. You can keep playing.'); }
    }
    async function attach() {
        const epoch = ++frameEpoch;
        if (!frame.getAttribute('src')) return;
        if (adapter) adapter.destroy();
        const instance = new window.CercoSkinsAdapter(frame); adapter = instance;
        try {
            const [live, state, capabilities] = await Promise.all([instance.catalog(), instance.equipped(), instance.capabilities(), service.refresh()]);
            if (epoch !== frameEpoch) return;
            if (capabilities.protocol !== 1 || capabilities.game !== 'CERCO' || live.schema !== 'cerco.skins.v1' ||
                !['0.8.1', '0.8.3', '0.9.0', '0.9.1', '0.9.2', '0.9.3'].includes(live.gameVersion) || state.cosmeticOnly !== true) throw new Error();
            const inv = service.getState()?.inventory; if (!inv) throw new Error();
            await applySkin(inv.equippedSkinId, instance); render();
        } catch (_) { if (epoch === frameEpoch) { announce('Skins service unavailable. Original remains available in the game.'); render(); } }
    }
    frame.addEventListener('load', () => { void attach(); });
    window.addEventListener('cerco:cosmetics', render);
    window.addEventListener('cerco:receipt-status', event => {
        document.getElementById('cosmetic-receipt-status').textContent = event.detail.text;
    });
    let profileId = window.CERCO_GUEST_PROFILE.getProfile()?.guestId || null;
    window.addEventListener('cerco:guest-profile', () => {
        const id = window.CERCO_GUEST_PROFILE.getProfile()?.guestId || null;
        if (id === profileId) return; profileId = id;
        document.getElementById('cosmetic-receipt-status').textContent = 'Rewards require verification before spending.';
        if (adapter) { void applySkin('cerco.default').catch(()=>{}); void attach(); }
    });
    for (const selector of ['[data-panel="shop"]', '[data-panel="settings"]', '#cosmetic-refresh'])
        document.querySelector(selector)?.addEventListener('click', () => { void refresh(); });
    fetch('./assets/skins/cerco/CERCO_SKIN_CATALOG_v1.json').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => {
        const ids = ['cerco.default', 'cerco.void_circuit'];
        if (data.schema !== 'cerco.skins.v1' || data.skins.length !== 2 || !data.skins.every((s, i) => s.id === ids[i] && s.cosmeticOnly === true &&
            ['cerco_skin_original.png', 'cerco_skin_void_circuit.png'].includes(s.previewAsset))) throw new Error();
        catalog = data; render(); void refresh();
    }).catch(() => { announce('Skin catalog unavailable. Please reload when connected.'); });
})();
