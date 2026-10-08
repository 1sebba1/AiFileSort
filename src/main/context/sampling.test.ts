import { evenSample } from './sampling';

describe('evenSample', () => {
  it('returns everything when under the limit', () => {
    expect(evenSample(['a', 'b'], 5)).toEqual(['a', 'b']);
  });
  it('spreads the sample across the whole list', () => {
    const items = Array.from({ length: 100 }, (_, i) => String(i));
    expect(evenSample(items, 4)).toEqual(['0', '25', '50', '75']);
  });
});
