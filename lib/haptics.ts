function vibrate(pattern: number | number[]): void {
  // Sur Safari iOS, `"vibrate" in navigator` répond true (la propriété est
  // déclarée) alors que `navigator.vibrate` n'est pas une fonction appelable
  // — d'où un TypeError silencieux qui gelait tout le jeu (voir CaviteScene
  // update()). On teste directement l'appelabilité plutôt que la présence
  // de la propriété.
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* certains navigateurs déclarent l'API sans l'implémenter réellement */
  }
}

export function vibrateLaunch(): void {
  vibrate(12);
}

export function vibrateBounce(): void {
  vibrate(16);
}

export function vibrateSharkHit(): void {
  vibrate([14, 40, 14]);
}

export function vibrateHit(): void {
  vibrate([26, 30, 40]);
}

export function vibrateMiss(): void {
  vibrate(70);
}
