/* PROYECTOZ LEADERBOARDS V052 */
/* PROYECTOZ LEADERBOARDS V055 */
(function () {
    'use strict';

    const panel = document.getElementById('pz-leaderboards');
    const nav = document.querySelector('[data-panel="leaderboard"]');
    const back = document.getElementById('pz-lb-back');
    const heading = document.getElementById('pz-lb-heading');
    const menu = document.getElementById('pz-lb-menu');
    const results = document.getElementById('pz-lb-results');
    const title = document.getElementById('pz-lb-mode-title');
    const status = document.getElementById('pz-lb-status');
    const position = document.getElementById('pz-lb-position');
    const positionValue = document.getElementById('pz-lb-position-value');
    const columnA = document.getElementById('pz-lb-column-a');
    const columnB = document.getElementById('pz-lb-column-b');
    const podium = [1, 2, 3].map(n =>
        document.getElementById('pz-lb-top' + n)
    );

    if (!panel || !nav || !back || !heading || !menu ||
        !results || !title || !status || !position ||
        !positionValue || !columnA || !columnB ||
        podium.some(x => !x)) return;

    let mode = null;

    function clearPodium() {
        podium.forEach(el => el.textContent = '—');
    }

    function populateEmptyRanks() {
        columnA.replaceChildren();
        columnB.replaceChildren();

        for (let rank = 1; rank <= 30; rank++) {
            const li = document.createElement('li');
            const value = document.createElement('span');
            /* PROYECTOZ CLAIM THE THRONE V076 */
            value.textContent = (rank === 1 && mode === 'universal')
                ? 'CLAIM THE THRONE'
                : '—';

            li.appendChild(value);

            (rank <= 15 ? columnA : columnB).appendChild(li);
        }
    }

    function showMenu() {
        mode = null;
        heading.textContent = 'LEADERBOARDS';
        menu.hidden = false;
        results.hidden = true;
        position.hidden = true;
        clearPodium();
    }

    function showMode(nextMode) {
        if (nextMode !== 'universal' && nextMode !== 'personal') return;

        mode = nextMode;
        menu.hidden = true;
        results.hidden = false;

        const universal = nextMode === 'universal';

        heading.textContent = universal
            ? 'UNIVERSAL LEADERBOARD'
            : 'PERSONAL LEADERBOARD';

        title.textContent = universal ? 'TOP PLAYERS' : 'TOP GAMES';

        position.hidden = !universal;
        positionValue.textContent = '—';

        status.textContent = universal
            ? 'ONLINE RANKING PENDING'
            : 'PERSONAL RECORDS PENDING';

        populateEmptyRanks();
        clearPodium();
    }

    /* PROYECTOZ NAVIGATION V062 */
    nav.addEventListener('click', () => {
        const shop = document.getElementById('pz-shop');

        if (shop) {
            shop.hidden = true;
        }

        showMenu();
        panel.hidden = false;
    });

    back.addEventListener('click', () => {
        if (mode !== null) {
            showMenu();
        } else {
            panel.hidden = true;
        }
    });

    panel.querySelectorAll('[data-lb-mode]').forEach(button => {
        button.addEventListener('click', () => {
            showMode(button.dataset.lbMode);
        });
    });
})();