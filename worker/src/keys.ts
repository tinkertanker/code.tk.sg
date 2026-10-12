// Alternate consonants and vowels, choosing either starting parity as in Rust.
export function key(length: number): string {
  const start = random(2);
  return Array.from({ length: length || 10 }, (_, i) => {
    const space = i % 2 === start ? 'bcdfghjklmnpqrstvwxz' : 'aeiouy';
    return space[random(space.length)];
  }).join('');
}

function random(size: number): number {
  // Rejection sampling avoids modulo bias.
  const sample = new Uint32Array(1);
  const ceiling = Math.floor(0x100000000 / size) * size;
  do { crypto.getRandomValues(sample); } while (sample[0] >= ceiling);
  return sample[0] % size;
}
