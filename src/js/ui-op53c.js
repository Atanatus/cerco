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
  figure.dataset.defaultPicture = 'ProfilePic1';

  const defaultImage = document.createElement('img');
  defaultImage.src = './assets/profile-pictures/ProfilePic1.png';
  defaultImage.alt = 'Default profile picture';
  defaultImage.width = 112;
  defaultImage.height = 112;
  defaultImage.loading = 'lazy';
  defaultImage.decoding = 'async';

  const caption = document.createElement('figcaption');
  caption.textContent = 'DEFAULT · FREE';

  figure.append(defaultImage, caption);
  gallery.prepend(figure);

  // ProfilePic2 is intentionally display-only.
  // No buy button, price authority, entitlement or ledger change.
  const card = document.createElement('article');
  card.className = 'cerco-picture-preview';
  card.dataset.profilePicturePreview = 'ProfilePic2';

  const paidImage = document.createElement('img');
  paidImage.src = './assets/profile-pictures/ProfilePic2.png';
  paidImage.alt = 'Profile picture 02 preview';
  paidImage.width = 160;
  paidImage.height = 160;
  paidImage.loading = 'lazy';
  paidImage.decoding = 'async';

  const heading = document.createElement('h4');
  heading.textContent = 'PROFILE PICTURE 02';

  const state = document.createElement('p');
  state.textContent = 'COMING SOON';

  const note = document.createElement('p');
  note.className = 'cerco-picture-note';
  note.textContent = 'Purchase unavailable until server activation.';

  card.append(paidImage, heading, state, note);
  shop.replaceChildren(card);

  document.documentElement.dataset.cercoProfilePictures = 'preview';
})();
