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
    let generation = 0, request = null;

    function cancelRequest() {
        generation++;
        if (request) { clearTimeout(request.timer); request.controller.abort(); request = null; }
    }

    function clearPodium() {
        podium.forEach(el => el.textContent = '—');
    }

    function renderRanks(entries, state) {
        panel.dataset.lbMode = mode || '';
        panel.dataset.rankingState = state;
        columnA.replaceChildren();
        columnB.replaceChildren();

        for (let rank = 1; rank <= 30; rank++) {
            const li = document.createElement('li');
            const value = document.createElement('span');
            const entry = entries[rank - 1];
            value.textContent = entry
                ? entry.display_name + ' · ' + entry.best_value.toLocaleString('en-US')
                : rank === 1 && mode === 'universal'
                    ? state === 'empty' ? 'CLAIM THE THRONE' : state === 'loading' ? 'CHECKING…' : 'UNKNOWN'
                    : '—';

            li.appendChild(value);

            (rank <= 15 ? columnA : columnB).appendChild(li);
        }
        podium.forEach((el, i) => { el.textContent = entries[i]?.display_name || '—'; });
    }

    function showMenu() {
        cancelRequest();
        mode = null;
        panel.dataset.lbMode = '';
        panel.dataset.rankingState = 'idle';
        heading.textContent = 'LEADERBOARDS';
        menu.hidden = false;
        results.hidden = true;
        position.hidden = true;
        clearPodium();
    }

    function showMode(nextMode) {
        if (nextMode !== 'universal' && nextMode !== 'personal') return;

        cancelRequest();
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

        renderRanks([], universal ? 'loading' : 'personal');

        /* CERCO ONLINE LEADERBOARD V1 */
        if (universal) {
            status.textContent = 'CONNECTING TO CERCO...';
            const requestedGeneration = generation;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            request = { controller, timer };

            fetch('https://cerco-api.atanatus.workers.dev/leaderboards?kind=guest&metric=score&ruleset=CERCO-0.9.0',
                { cache: 'no-store', signal: controller.signal })
                .then(response => {
                    if (!response.ok) throw new Error('API unavailable');
                    return response.json();
                })
                .then(data => {
                    if (generation !== requestedGeneration || mode !== 'universal' || panel.hidden) return;

                    if (data.leaderboard !== 'guest' ||
                        data.metric !== 'score' || data.ruleset !== 'CERCO-0.9.0' || !Array.isArray(data.entries) || data.entries.length > 50 ||
                        !data.entries.every(entry => entry && typeof entry.display_name === 'string' &&
                            entry.display_name.trim().length > 0 && entry.display_name.length <= 200 &&
                            typeof entry.best_value === 'number' && Number.isFinite(entry.best_value) && entry.best_value >= 0)) {
                        throw new Error('Invalid response');
                    }

                    const entries = data.entries.slice(0, 30);
                    renderRanks(entries, entries.length ? 'ready' : 'empty');

                    status.textContent = entries.length
                        ? 'CERCO · GUEST RANKING'
                        : 'NO VERIFIED RECORDS YET';
                })
                .catch(() => {
                    if (generation === requestedGeneration && mode === 'universal' && !panel.hidden) {
                        renderRanks([], 'unavailable');
                        status.textContent = 'RANKING UNAVAILABLE · RESULTS UNKNOWN';
                    }
                })
                .finally(() => {
                    clearTimeout(timer);
                    if (generation === requestedGeneration) request = null;
                });
        }
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
