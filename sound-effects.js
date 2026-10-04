(() => {
  const sources = {
    correct: 'assets/audio/correct.wav',
    levelUp: 'assets/audio/level-up.wav',
    incorrect: 'assets/audio/incorrect.wav',
    countdown: 'assets/audio/countdown.wav',
    finish: 'assets/audio/finish.wav',
  };
  const sounds = new Map();
  const active = new Set();

  function getSound(name) {
    if (!Object.prototype.hasOwnProperty.call(sources, name)) throw new Error(`Unknown sound effect: ${name}`);
    if (!sounds.has(name)) {
      const sound = new Audio(sources[name]);
      sound.preload = 'auto';
      sound.addEventListener('error', () => {
        console.error(`Failed to load sound effect "${name}"`, sound.error);
      }, { once: true });
      sounds.set(name, sound);
    }
    return sounds.get(name);
  }

  function play(name, volume = 0.18) {
    const source = getSound(name);
    const sound = source.paused ? source : source.cloneNode();
    sound.volume = volume;
    active.add(sound);
    sound.addEventListener('ended', () => active.delete(sound), { once: true });
    const result = sound.play();
    if (result && typeof result.catch === 'function') {
      result.catch((error) => {
        active.delete(sound);
        console.error(`Could not play sound effect "${name}"`, error);
      });
    }
    return sound;
  }

  function stop() {
    active.forEach((sound) => {
      sound.pause();
      sound.currentTime = 0;
      active.delete(sound);
    });
  }

  window.GameSounds = Object.freeze({ play, stop });
})();
