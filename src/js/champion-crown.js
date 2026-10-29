/* PROYECTOZ GOLDEN RANK V075 */
(function () {
    'use strict';

    const panel = document.getElementById('pz-leaderboards');
    const heading = document.getElementById('pz-lb-heading');
    const columnA = document.getElementById('pz-lb-column-a');

    if (!panel || !heading || !columnA) {
        console.warn('[GOLDEN RANK] Required elements missing.');
        return;
    }

    function updatePodiumCrowns() {
        panel.querySelectorAll('.pz-lb-podium strong').forEach(function (title, index) {
            if (index !== 0) return;
            let crown = title.querySelector('.pz-top-crown');
            if (!crown) {

            crown = document.createElement('span');
            crown.className = 'pz-top-crown';
            crown.textContent = '\uD83D\uDC51';
            crown.setAttribute('aria-hidden', 'true');
            title.prepend(crown);
            }
            crown.hidden = panel.dataset.lbMode !== 'universal' || panel.dataset.rankingState !== 'ready';
        });
    }

    function updateGoldenRank() {
        const firstRow = columnA.querySelector('li:first-child');
        if (!firstRow) return;

        firstRow.querySelectorAll('.pz-rank-crown').forEach(function (crown) {
            crown.remove();
        });

        const universal = panel.dataset.lbMode === 'universal' &&
            ['ready', 'empty'].includes(panel.dataset.rankingState);

        firstRow.classList.toggle('pz-golden-rank', universal);
    }

    function update() {
        updatePodiumCrowns();
        updateGoldenRank();
    }

    const observer = new MutationObserver(function () {
        observer.disconnect();

        try {
            update();
        } finally {
            observer.observe(panel, {
                subtree: true,
                childList: true,
                characterData: true
            });
        }
    });

    update();

    observer.observe(panel, {
        subtree: true,
        childList: true,
        characterData: true
    });
})();
