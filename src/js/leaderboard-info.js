/* PROYECTOZ HOW IT WORKS V083 */
(function () {
    'use strict';

    function init() {
        const panel = document.getElementById('pz-leaderboards');
        const area = document.getElementById('pz-lb-info-area');
        const card = document.getElementById('pz-lb-info-card');
        const close = document.getElementById('pz-lb-info-close');
        const description = document.getElementById('pz-lb-info-description');
        const heading = document.getElementById('pz-lb-heading');

        if (!panel || !area || !card || !close || !heading) return;

        // Return the information panel to the leaderboard root.
        if (area.parentElement !== panel) {
            panel.insertBefore(area, panel.firstChild);
        }

        let dismissed = false;
        let previousHeading = '';

        function update() {
            const current = heading.textContent.trim();
            const isRanking =
                current === 'UNIVERSAL LEADERBOARD' ||
                current === 'PERSONAL LEADERBOARD';

            if (current !== previousHeading) {
                dismissed = false;
                previousHeading = current;
            }

            const visible = !panel.hidden && isRanking && !dismissed;
            area.hidden = !visible;
            card.hidden = !visible;

            if (description) {
                description.textContent =
                    current === 'UNIVERSAL LEADERBOARD'
                        ? 'Global player rankings will appear here when online scores are available.'
                        : 'Your personal best games and records will appear here.';
            }
        }

        close.addEventListener('click', function () {
            dismissed = true;
            update();
        });

        const observer = new MutationObserver(update);
        observer.observe(panel, {
            attributes: true,
            attributeFilter: ['hidden']
        });
        observer.observe(heading, {
            childList: true,
            characterData: true,
            subtree: true
        });

        document.querySelectorAll('[data-lb-mode]').forEach(function (button) {
            button.addEventListener('click', function () {
                dismissed = false;
                queueMicrotask(update);
            });
        });

        update();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();


/* PROYECTOZ INFO BELOW POSITION V084 */
(function () {
    'use strict';

    function init() {
        const panel = document.getElementById('pz-leaderboards');
        const position = document.getElementById('pz-lb-position');

        if (!panel || !position) return;

        function alignInfo() {
            const area = document.getElementById('pz-lb-info-area');
            if (!area || area.hidden || position.hidden || panel.hidden) return;

            const panelRect = panel.getBoundingClientRect();
            const cardRect = position.getBoundingClientRect();

            panel.style.setProperty(
                '--pz-info-left',
                (cardRect.left - panelRect.left) + 'px'
            );
            panel.style.setProperty(
                '--pz-info-top',
                (cardRect.bottom - panelRect.top + 10) + 'px'
            );
            panel.style.setProperty(
                '--pz-info-width',
                cardRect.width + 'px'
            );
        }

        const observer = new MutationObserver(alignInfo);

        observer.observe(panel, {
            attributes: true,
            attributeFilter: ['hidden']
        });

        observer.observe(position, {
            attributes: true,
            attributeFilter: ['hidden']
        });

        const heading = document.getElementById('pz-lb-heading');
        if (heading) {
            observer.observe(heading, {
                childList: true,
                subtree: true
            });
        }

        window.addEventListener('resize', alignInfo);
        requestAnimationFrame(alignInfo);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();


/* PROYECTOZ INFO RIGHT V085 */
(function () {
    'use strict';

    function init() {
        const panel = document.getElementById('pz-leaderboards');
        const ranking = panel?.querySelector('.pz-lb-ranking');
        const area = document.getElementById('pz-lb-info-area');

        if (!panel || !ranking || !area) return;

        function alignInfoRight() {
            if (panel.hidden || area.hidden) return;

            const panelRect = panel.getBoundingClientRect();
            const rankRect = ranking.getBoundingClientRect();

            const gap = 12;
            const rightMargin = 12;

            const left = rankRect.right - panelRect.left + gap;
            const available = panelRect.right - rankRect.right -
                              gap - rightMargin;

            const width = Math.max(0, available);

            panel.style.setProperty('--pz-v085-left', left + 'px');
            panel.style.setProperty(
                '--pz-v085-top',
                (rankRect.top - panelRect.top) + 'px'
            );
            panel.style.setProperty('--pz-v085-width', width + 'px');

            area.style.visibility = width >= 130 ? 'visible' : 'hidden';
        }

        const observer = new MutationObserver(alignInfoRight);

        observer.observe(panel, {
            attributes: true,
            attributeFilter: ['hidden']
        });

        observer.observe(area, {
            attributes: true,
            attributeFilter: ['hidden']
        });

        const heading = document.getElementById('pz-lb-heading');

        if (heading) {
            observer.observe(heading, {
                childList: true,
                subtree: true
            });
        }

        window.addEventListener('resize', alignInfoRight);

        if (typeof ResizeObserver !== 'undefined') {
            const resizeObserver = new ResizeObserver(alignInfoRight);
            resizeObserver.observe(panel);
            resizeObserver.observe(ranking);
        }

        requestAnimationFrame(alignInfoRight);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();