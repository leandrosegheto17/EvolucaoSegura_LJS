import { expect, it } from 'vitest';

it('roda depois do globalSetup', () => {
  expect(1 + 1).toBe(2);
});
