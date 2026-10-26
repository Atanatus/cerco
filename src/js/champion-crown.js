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
        panel.querySelectorAll('.pz-lb-podium strong').forEach(function (title) {
            if (title.textContent.trim() !== 'TOP #1') return;
            if (title.querySelector('.pz-top-crown')) return;

            const crown = document.createElement('span');
            crown.className = 'pz-top-crown';
            crown.textContent = '\uD83D\uDC51';
            crown.setAttribute('aria-hidden', 'true');
            crown.style.display = 'inline-block';
            crown.style.marginRight = '6px';
            crown.style.verticalAlign = 'middle';
            crown.style.fontSize = '1.15em';
            crown.style.lineHeight = '1';

            title.prepend(crown);
        });
    }

    function updateGoldenRank() {
        const firstRow = columnA.querySelector('li:first-child');
        if (!firstRow) return;

        firstRow.querySelectorAll('.pz-rank-crown').forEach(function (crown) {
            crown.remove();
        });

        const universal =
            heading.textContent.trim() === 'UNIVERSAL LEADERBOARD';

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