/* PROYECTOZ SHOP V058 */
(function () {
    'use strict';

    const panel = document.getElementById('pz-shop');
    const nav = document.querySelector('[data-panel="shop"]');
    const back = document.getElementById('pz-shop-back');
    const leaderboards = document.getElementById('pz-leaderboards');

    if (!panel || !nav || !back) {
        console.warn('[SHOP] Required elements not found.');
        return;
    }

    let previousLeaderboardVisibility = false;

    /* PROYECTOZ NAVIGATION V062 */
    nav.addEventListener('click', function () {
        previousLeaderboardVisibility = false;

        if (leaderboards) {
            leaderboards.hidden = true;
        }

        panel.hidden = false;
    });

    back.addEventListener('click', function () {
        panel.hidden = true;

        if (leaderboards && previousLeaderboardVisibility) {
            leaderboards.hidden = false;
        }

        previousLeaderboardVisibility = false;
    });
})();