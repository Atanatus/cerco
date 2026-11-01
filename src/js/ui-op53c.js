/* CERCO OP53C — Profile picture presentation.
   No purchase, grant or local ownership authority. */
(() => {
  'use strict';

  const gallery = document.getElementById('pz-avatar-gallery');
  const shop = document.getElementById('pz-shop-avatars');
  const avatar = document.querySelector('.player-panel .player-avatar');

  if (!gallery || !shop || !avatar) {
    throw new Error('[CERCO 53C] Required profile UI missing.');
  }

  if (gallery.querySelector('[data-default-picture]') ||
      shop.querySelector('[data-profile-picture-preview]')) {
    throw new Error('[CERCO 53C] Picture UI already mounted.');
  }

  // Protect existing SHOP items against accidental replacement.
  const placeholder = shop.querySelector(':scope > .pz-shop-placeholder');

  if (shop.children.length !== 1 ||
      !placeholder ||
      shop.querySelector('button')) {
    throw new Error('[CERCO 53C] Unexpected profile shop content.');
  }

  // Default is a visual fallback, not a database entitlement.
  const figure = document.createElement('figure');
  figure.className = 'cerco-picture-default';
  figure.dataset.defaultPicture = 'Profile_Picture1';

  const defaultImage = document.createElement('img');
  defaultImage.src = './assets/profile-pictures/Profile_Picture1.png';
  defaultImage.alt = 'Default profile picture';
  defaultImage.width = 112;
  defaultImage.height = 112;
  defaultImage.loading = 'lazy';
  defaultImage.decoding = 'async';

  const caption = document.createElement('figcaption');
  caption.textContent = 'DEFAULT · FREE';

  figure.append(defaultImage, caption);
  gallery.prepend(figure);

  // Profile pictures 02-06: preview only, no purchase authority.
  const pictures = [
    'Profile_Picture2.png',
    'Profile_Picture3.png',
    'Profile_Picture4.png',
    'Profile_Picture5.png',
    'Profile_Picture6.png'
  ];

  const cards = pictures.map((file, index) => {
    const number = String(index + 2).padStart(2, '0');

    const card = document.createElement('article');
    card.className = 'cerco-picture-preview';
    card.dataset.profilePicturePreview = file.slice(0, -4);

    const image = document.createElement('img');
    image.src = './assets/profile-pictures/' + file;
    image.alt = 'Profile picture ' + number + ' preview';
    image.width = 160;
    image.height = 160;
    image.loading = 'lazy';
    image.decoding = 'async';

    const heading = document.createElement('h4');
    heading.textContent = 'PROFILE PICTURE ' + number;

    const state = document.createElement('p');
    state.textContent = 'COMING SOON';

    const note = document.createElement('p');
    note.className = 'cerco-picture-note';
    note.textContent = 'Purchase unavailable until server activation.';

    card.append(image, heading, state, note);
    return card;
  });

  shop.replaceChildren(...cards);

  document.documentElement.dataset.cercoProfilePictures = 'preview';
})();
