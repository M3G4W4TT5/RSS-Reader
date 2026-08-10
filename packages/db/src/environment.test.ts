import { describe, expect, it } from 'vitest';
import { assertDevelopmentResetIsSafe } from './environment';

describe('assertDevelopmentResetIsSafe', () => {
  it('accepts the documented local development database', () => {
    expect(() =>
      assertDevelopmentResetIsSafe(
        'postgresql://reader:reader_dev@127.0.0.1:5432/reader',
      ),
    ).not.toThrow();
  });

  it('rejects remote or differently named databases', () => {
    expect(() =>
      assertDevelopmentResetIsSafe(
        'postgresql://reader:password@example.com:5432/reader',
      ),
    ).toThrow(/Refusing to reset/);
  });
});

