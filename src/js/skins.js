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

    /*
     * Future inventory integration:
     * Populate #pz-skins-grid only with genuinely owned skins.
     * Each item should use .pz-skins-item.
     * Do not invent products or unlocks.
     */
    grid.replaceChildren();
    empty.hidden = false;
})();