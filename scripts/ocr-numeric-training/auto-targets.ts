import {readTooltipRequirement} from '../../features/calculator/ocr/parseMapleTooltip';
import type {OcrReview, OcrReviewLine} from '../../features/calculator/ocr/types';

export const requirementLabels=['LEV','STR','DEX','INT','LUK'] as const;
export type Label=typeof requirementLabels[number];

/** Same unique-line rule as the prior numeric experiment, extended to all five labels.
 * No image ID, expected value, manual coordinates, or numeric-model output is consulted. */
export function automaticTargets(review: OcrReview): Array<{field:Label;line?:OcrReviewLine;failure?:string}> {
  return requirementLabels.map(field=>{
    const candidates=review.lines.filter(line=>line.bounds && (line.suspectedRequirement?.labels.length===1
      ? line.suspectedRequirement.labels[0]===field
      : line.readings.some(r=>readTooltipRequirement(r.text)?.label===field)));
    return candidates.length===1?{field,line:candidates[0]}:{field,failure:candidates.length?'multiple-field-rows':'field-row-not-found'};
  });
}
