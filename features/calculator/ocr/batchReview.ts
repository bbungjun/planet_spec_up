import type { EquipmentSlot, JobId } from "../domain/types";
import { isPendantCategory } from "../domain/pendants";
import { existingDuplicate, matchingSlots, occupied, tooltipIdentity, type OcrDestination, type OcrSlotChoice } from "./batch";
import { mapRecognizedStats } from "./mapRecognizedStats";
import { parseMapleTooltip } from "./parseMapleTooltip";
import { mapReviewedStats, reviewQuestions } from "./reviewRecognition";
import type { OcrReview } from "./types";

type ReviewSelection = { category: string | null; destination: OcrDestination; label: string; pendantChoice?: string; needsDestination: boolean };
type PlacementContext = {
  choices: OcrSlotChoice[];
  reserved: ReadonlySet<OcrDestination>;
  peers: readonly { name: string; text: string }[];
  sameImage?: string;
} & ({ kind: "initial" } | { kind: "retry"; previous: ReviewSelection; replacedFile: boolean; initialBusy: boolean });

/** Decode and validate once; placement can then use live rows after asynchronous image hashing.
 * Both initial recognition and retry cross this same interface for all review/destination rules.
 */
export function createBatchReview(text: string, review: OcrReview | undefined, job: JobId) {
  const parsed = { ...parseMapleTooltip(text), ...(review ? { category: review.category } : {}) };
  const replacement = review ? mapReviewedStats(review, job) : mapRecognizedStats(parsed, job);
  if (!Object.values(replacement).some(value => value !== "") && !(review && reviewQuestions(review, job).length)) return null;
  const identity = tooltipIdentity(text);
  return {
    place(context: PlacementContext) {
      const repeated = identity.signature ? context.peers.find(peer => (context.kind === "retry" || peer.name) && tooltipIdentity(peer.text).signature === identity.signature) : undefined;
      const warning = context.sameImage !== undefined ? `${context.sameImage}와 동일한 이미지입니다.`
        : repeated && parsed.category !== "반지" ? `${repeated.name}와 ${context.kind === "retry" || identity.name ? "이름·옵션" : "옵션"}이 같은 장비입니다. 중복 여부를 확인하세요.`
          : existingDuplicate(parsed, job, context.choices);
      const candidate = matchingSlots(parsed.category, context.choices).find(choice => !occupied(choice.equipment) && !context.reserved.has(choice.slot));
      const weapon = ["건", "석궁", "아대", "무기"].includes(parsed.category ?? "");
      const previous = context.kind === "retry" && !context.replacedFile && parsed.category === context.previous.category ? context.previous : null;
      const destination: OcrDestination = previous ? previous.destination : weapon
        ? `preset:${Number(replacement.ignoreDefensePercent) > 0 ? "chaos" : Number(replacement.bossDamagePercent) > 0 ? "boss" : "hunting"}`
        : !warning && candidate ? candidate.slot : "new";
      return {
        text, replacement, review: review ?? null, destination,
        needsDestination: previous ? previous.needsDestination : (context.kind === "retry" && context.initialBusy) || parsed.category === null
          || ((parsed.category === "반지" || isPendantCategory(parsed.category)) && destination === "new"),
        category: parsed.category, label: previous ? previous.label : parsed.category ?? "추가 장비",
        ...(context.kind === "retry" ? { pendantChoice: previous?.pendantChoice } : {}),
        warning, included: !warning,
      };
    },
  };
}

export function reserveBatchDestination(reserved: Set<EquipmentSlot>, destination: OcrDestination) {
  if (destination !== "new" && !destination.startsWith("preset:")) reserved.add(destination as EquipmentSlot);
}
