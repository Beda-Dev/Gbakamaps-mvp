// Matchers jest-dom (toBeInTheDocument, toHaveAttribute…) + nettoyage auto.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
