import { normalize, dot, meanDirection } from './vectorMath';

describe('vectorMath', () => {
  it('normalize scales to unit length and leaves zero vectors alone', () => {
    expect(normalize([3, 4])).toEqual([0.6, 0.8]);
    expect(normalize([0, 0])).toEqual([0, 0]);
  });
  it('dot multiplies component-wise and sums', () => {
    expect(dot([1, 2], [3, 4])).toBe(11);
  });
  it('meanDirection averages directions, not magnitudes', () => {
    const m = meanDirection([[10, 0], [0, 1]]);
    expect(m[0]).toBeCloseTo(Math.SQRT1_2);
    expect(m[1]).toBeCloseTo(Math.SQRT1_2);
  });
  it('meanDirection of nothing is an empty vector', () => {
    expect(meanDirection([])).toEqual([]);
  });
});
