/** Remove only a whole-row field prefix and an optional bonus '+' sign.
 * No O/Q/B replacement, internal-space removal, or nearest-value correction. */
export function rawNumericText(text, variant, kind) {
  if (typeof text !== 'string') return null;
  let value=text.normalize('NFKC').trim();
  if(variant==='whole-row') {
    const delimiter=Math.max(value.lastIndexOf(':'),value.lastIndexOf(';'));
    if(delimiter>=0) {
      if(/[\d+%]/.test(value.slice(0,delimiter)))return null;
      value=value.slice(delimiter+1).trim();
    } else {
      const match=value.match(/^(?:[A-Z!]+\s*)?(?:LEV|LEU|LEW|LE!|STR|STA|DEX)\s*(\+?[^:;]+)$/i);
      if(!match)return null;
      value=match[1].trim();
    }
  }
  if(kind==='bonus')value=value.replace(/^\+\s*/, '');
  return value;
}
