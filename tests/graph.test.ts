import { describe, it } from 'mocha';
import { expect } from 'chai';
import { containsCycle } from '../src/graph';
import { readGedcom } from 'read-gedcom';

describe('Graph processing', () => {
  const checkFor = (file: string[], doesContainCycle: boolean) => {
    const buffer = Buffer.from([...file, ''].join('\n'), 'utf-8');
    const gedcom = readGedcom(buffer);
    const result = containsCycle(gedcom);
    expect(result).to.equal(doesContainCycle);
  };

  it('file with no cycle', () => {
    /*
    0 -.- 1
       |
       2 -.- 3
          |
         4 5
     */
    checkFor([
      '0 HEAD',
      '0 @I0@ INDI',
      '0 @I1@ INDI',
      '0 @I2@ INDI',
      '0 @I3@ INDI',
      '0 @I4@ INDI',
      '0 @I5@ INDI',
      '0 @F0@ FAM',
      '1 HUSB @I0@',
      '1 WIFE @I1@',
      '1 CHIL @I2@',
      '0 @F1@ FAM',
      '1 HUSB @I2@',
      '1 WIFE @I3@',
      '1 CHIL @I4@',
      '1 CHIL @I5@',
      '0 TRLR',
    ], false);
  });

  it('file with a cycle', () => {
    /*
    0 -.- 1
       |
       2 -.- 3
          |
          0
    */
    checkFor([
      '0 HEAD',
      '0 @I0@ INDI',
      '0 @I1@ INDI',
      '0 @I2@ INDI',
      '0 @I3@ INDI',
      '0 @I4@ INDI',
      '0 @I5@ INDI',
      '0 @F0@ FAM',
      '1 HUSB @I0@',
      '1 WIFE @I1@',
      '1 CHIL @I2@',
      '0 @F1@ FAM',
      '1 HUSB @I2@',
      '1 WIFE @I3@',
      '1 CHIL @I0@',
      '0 TRLR',
    ], true);
  });
});
