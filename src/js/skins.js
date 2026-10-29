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

    const API = 'https://cerco-api.atanatus.workers.dev';
    const frame = document.getElementById('cerco-game-frame');
    const gallery = document.getElementById('pz-shop-skins');
    let adapter = null;
    let equipped = 'cerco.default';
    let catalog = null;
    const status = document.createElement('p');
    status.id = 'cerco-skin-status';
    status.setAttribute('role', 'status');
    panel.querySelector('.pz-skins-content').appendChild(status);

    async function api(path, skinId) {
        const profile = window.CERCO_GUEST_PROFILE;
        const identity = await profile?.ready;
        if (!identity) throw new Error('Guest profile unavailable');
        const authorization = await profile.authorizationHeaders();
        const response = await fetch(API + path, { method: skinId ? 'POST' : 'GET',
            headers: skinId ? { 'Content-Type': 'application/json', ...authorization } : authorization,
            body: skinId ? JSON.stringify({ skinId }) : undefined,
            signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('Skin service unavailable');
        return response.json();
    }
    async function equip(skinId) {
        if (!adapter) { status.textContent = 'Press PLAY first. Original is already equipped by default.'; return; }
        try {
            // Every equip is authorized by the server, never by browser inventory.
            const authorization = await api('/skins/equip', skinId);
            if (authorization.equippedSkinId !== skinId || authorization.cosmeticOnly !== true ||
                authorization.guest_id !== window.CERCO_GUEST_PROFILE.getProfile()?.guestId || authorization.authenticated !== true) throw new Error();
            const result = await adapter.equip(authorization.equippedSkinId);
            if (result.skinId !== skinId || result.cosmeticOnly !== true) throw new Error();
            equipped = skinId;
            render();
            status.textContent = 'Original equipped. Appearance only.';
        } catch (_) { status.textContent = 'Unable to authorize this appearance. Please try again when connected.'; }
    }
    function card(skin, inventory) {
        const item = document.createElement('article');
        item.className = 'cerco-skin-card';
        const image = document.createElement('img');
        image.src = './assets/skins/cerco/' + skin.previewAsset;
        image.alt = skin.name + ' official preview'; image.width = 160; image.height = 160;
        const name = document.createElement('h4'); name.textContent = skin.name;
        const description = document.createElement('p'); description.textContent = skin.description;
        const button = document.createElement('button'); button.type = 'button';
        if (skin.id === 'cerco.default') {
            button.textContent = inventory && equipped === skin.id ? 'Equipped · free' : 'Use Original · free';
            button.setAttribute('aria-pressed', String(inventory && equipped === skin.id));
            button.addEventListener('click', () => { void equip(skin.id); });
        } else {
            button.textContent = 'Purchase coming soon'; button.disabled = true;
            button.title = 'Account ownership and purchases are not available yet.';
        }
        item.append(image, name, description, button);
        if (adapter) {
            const preview = document.createElement('button'); preview.type = 'button'; preview.textContent = 'Preview';
            preview.addEventListener('click', async () => {
                try {
                    const p = await adapter.preview(skin.id, 256);
                    if (p.skinId === skin.id && p.mimeType === 'image/png' && typeof p.dataUrl === 'string' &&
                        p.dataUrl.length < 500000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(p.dataUrl)) image.src = p.dataUrl;
                } catch (_) { status.textContent = 'Live preview unavailable. Showing the official thumbnail.'; }
            });
            item.appendChild(preview);
        }
        return item;
    }
    function render() {
        if (!catalog) return;
        gallery.replaceChildren(...catalog.skins.map(skin => card(skin, false)));
        // No economic backend exists. Only the unconditional free entitlement is owned.
        grid.replaceChildren(...catalog.skins.filter(skin => skin.id === 'cerco.default').map(skin => card(skin, true)));
        empty.hidden = true;
    }
    async function attach() {
        if (!frame.getAttribute('src')) return;
        if (adapter) adapter.destroy();
        try {
            adapter = new window.CercoSkinsAdapter(frame);
            const [live, state, inventory, capabilities] = await Promise.all([adapter.catalog(), adapter.equipped(), api('/skins/inventory'), adapter.capabilities()]);
            if (capabilities.protocol !== 1 || capabilities.game !== 'CERCO' || live.schema !== 'cerco.skins.v1' || !['0.8.1', '0.8.3', '0.9.0'].includes(live.gameVersion) || state.cosmeticOnly !== true ||
                inventory.authenticated !== true || inventory.guest_id !== window.CERCO_GUEST_PROFILE.getProfile()?.guestId ||
                !inventory.ownedSkinIds?.includes('cerco.default')) throw new Error();
            // Paid IDs from local events/storage never authorize equipment.
            await equip('cerco.default');
            render();
        } catch (_) { status.textContent = 'Skins service unavailable. Original remains available in the game.'; render(); }
    }
    frame.addEventListener('load', () => { void attach(); });
    fetch('./assets/skins/cerco/CERCO_SKIN_CATALOG_v1.json').then(r => {
        if (!r.ok) throw new Error(); return r.json();
    }).then(data => {
        const ids = ['cerco.default', 'cerco.void_circuit'];
        if (data.schema !== 'cerco.skins.v1' || data.skins.length !== 2 ||
            !data.skins.every((s, i) => s.id === ids[i] && s.cosmeticOnly === true &&
                ['cerco_skin_original.png', 'cerco_skin_void_circuit.png'].includes(s.previewAsset))) throw new Error();
        catalog = data; render();
    }).catch(() => { status.textContent = 'Skin catalog unavailable. Please reload when connected.'; });
})();
