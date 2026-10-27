'use strict';

const gameRoot = document.getElementById('game-root');

if (!gameRoot) {
  throw new Error('Missing container #game-root');
}

console.info('[CERCO] Application initialized');
