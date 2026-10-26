/* PROYECTOZ PROFILE PHOTO V059 */
/* PROYECTOZ PROFILE PICTURES MODAL V060 */
(function () {
    'use strict';

    const button = document.getElementById('pz-photo-change');
    const modal = document.getElementById('pz-avatar-modal');
    const close = document.getElementById('pz-avatar-modal-close');

    if (!button || !modal || !close) {
        console.warn('[PROFILE PICTURES] Required elements missing.');
        return;
    }

    button.addEventListener('click', function () {
        if (!modal.open) {
            modal.showModal();
        }
    });

    close.addEventListener('click', function () {
        modal.close();
    });

    modal.addEventListener('click', function (event) {
        if (event.target === modal) {
            modal.close();
        }
    });
})();