import type { EquipmentSlot, JobId } from "../domain/types";

// Original UI illustrations carried over from the approved local design preview.
const drawings: Record<string, string> = {
  crossbow: '<path d="m6 11 6-5 14 12 13-1 4 7-10 4-8-5-8 20-8-3 11-24" fill="#9a7c56" stroke="#435d73" stroke-width="2"/><path d="M7 7Q37 8 40 39M7 7l7 29 26 3" fill="none" stroke="#d0b361" stroke-width="3"/><path d="m14 36 21-24" stroke="#c6e8ed" stroke-width="3"/>',
  claw: '<path d="m8 20 21-8 13 12-6 17-24-4z" fill="#748ba3" stroke="#435d73" stroke-width="2"/><path d="m20 18 4-15 4 13m0 3 7-14 0 16m-1 2 11-10-5 17" fill="#d5e9e9" stroke="#435d73" stroke-width="2"/><path d="m12 26 24 3-4 8-17-4z" fill="#cfb673"/>',
  potion: '<path d="m18 5 12 0 0 12 11 14-3 12-27 0-4-12 11-14z" fill="#bedfe6" stroke="#486d82" stroke-width="2"/><path d="m12 29 23 0 2 9-25 0z" fill="#a4c77f"/><path d="m16 4 16 0 0 7-16 0z" fill="#b9905c" stroke="#6a6450" stroke-width="2"/><path d="m17 23-3 10" stroke="#fff" stroke-width="3"/>',
  projectile: '<path d="m16 17 9-13 9 13 0 24-18 0z" fill="#ddc787" stroke="#756a4b" stroke-width="2"/><path d="m16 17 18 0 0 8-18 0z" fill="#b8d6e2" stroke="#52758b" stroke-width="2"/><path d="m21 27 0 10" stroke="#fff2ba" stroke-width="3"/>',
  leaf: '<path d="m23 2 5 11 8-5-2 11 10 2-10 8 2 9-11-4-3 10-2-14-12 5 3-11-9-7 12-2-1-10 8 7z" fill="#efa244" stroke="#b57b3b" stroke-width="1.5"/><path d="m22 31 1-16m0 12 8-6m-8 4-8-5" stroke="#ffe3a1" stroke-width="1.5"/>',
  glove: '<path d="m9 25-3-7 2-4 4 1 4 6-1-12 3-3 4 2 1 11 1-14 4-2 4 3-1 14 3-12 4-1 3 3-3 15 3-6 4 1-1 11-6 9-1 5-21-1-1-6z" fill="#a17a4c" stroke="#475561" stroke-width="2"/><path d="m17 27 18-1-1 10-17-1z" fill="#c09a65"/><path d="m15 35 23 1-2 7-19-1z" fill="#7e603e" stroke="#48525a" stroke-width="2"/><path d="m17 39 17 1" stroke="#dfc78e" stroke-width="2"/><path d="m19 11 1 11m7-13-1 13m10-10-3 13" stroke="#e1bd7e" stroke-width="2"/>',
  hat: '<path d="m9 23 2-8 6-6 15-1 6 6 2 11 5 4-3 7-10 2-22-3-6-6z" fill="#786d53" stroke="#364b56" stroke-width="2"/><path d="m11 24 3-9 19-3 4 13" fill="#b39459"/><path d="m8 27 32-1-1 7-28-1z" fill="#5b635b" stroke="#374f58" stroke-width="2"/><path d="m14 13 4 9m13-10-2 10" stroke="#d9bb7a" stroke-width="3"/><path d="m19 23 10 0 1 8-11 0z" fill="#dbbd69" stroke="#4a5355" stroke-width="2"/><path d="m22 26 5 0 0 3-5 0z" fill="#74837d"/>',
  ring: '<ellipse cx="24" cy="29" rx="13" ry="12" fill="none" stroke="#466079" stroke-width="7"/><ellipse cx="24" cy="29" rx="13" ry="12" fill="none" stroke="#b5d2df" stroke-width="4"/><path d="m18 8 11 0 5 6-10 11-11-11z" fill="#69b7d1" stroke="#3d6178" stroke-width="2"/><path d="m18 8 6 12 5-12m-15 6h19" fill="none" stroke="#e3fcff" stroke-width="1.5"/>',
  pendant: '<path d="M10 6c0 22 6 23 14 29 10-8 14-13 14-29" fill="none" stroke="#5d6766" stroke-width="5"/><path d="M10 6c0 22 6 23 14 29 10-8 14-13 14-29" fill="none" stroke="#e8ca79" stroke-width="2.5"/><path d="m24 25 10 8-3 9-13 0-4-9z" fill="#d9b15d" stroke="#7a7049" stroke-width="2"/><path d="m24 29 5 5-2 5-6 0-3-5z" fill="#c76864"/><path d="m23 29 3 5-5 0z" fill="#ffb59c"/>',
  top: '<path d="m15 7 8 5 10-5 11 13-9 8-2 16-20 0-2-17-8-7z" fill="#d3e4e6" stroke="#486778" stroke-width="2"/><path d="m15 7 8 6 10-6-6 16-8 0z" fill="#7996b7"/><path d="m15 24 18 0-1 19-18 0z" fill="#6d94b9"/><path d="m15 32 17 0m-9-7v17" stroke="#a9d2de" stroke-width="3"/>',
  pants: '<path d="m13 6 23 0 2 14-4 23-12-1 0-19-2 19-11-1 1-22z" fill="#7696b0" stroke="#435d73" stroke-width="2"/><path d="m15 7 18 0-1 5-19 0z" fill="#dbc883"/><path d="m16 17-3 21m18-21-3 21" stroke="#b0d2df" stroke-width="3"/><path d="m22 8h5v6h-5z" fill="#786a43"/>',
  shoes: '<path d="m13 8 14-2 2 22 11 6 1 8-29 1-6-7 7-11z" fill="#56748c" stroke="#364e65" stroke-width="2"/><path d="m13 8 14-2 0 9-13 3z" fill="#9eb6bf"/><path d="m7 35 13 4 20-1-1 5-27 0z" fill="#d1bf85" stroke="#5c6b6b" stroke-width="1.5"/><path d="m15 20 11-2m-11 8 12-2" stroke="#d8c689" stroke-width="2"/>',
  cape: '<path d="m15 5 17 0 0 8 12 29-13-3-7 5-8-5-12 3 11-29z" fill="#b66c7d" stroke="#63586e" stroke-width="2"/><path d="m19 11-4 25m13-25 5 25" stroke="#e8a5ad" stroke-width="3"/><path d="m15 5 17 0-3 9-11 0z" fill="#e6c593"/><circle cx="24" cy="12" r="3" fill="#c5b564"/>',
  weapon: '<path d="m5 16 33-5 6 4-3 9-20 2-4 15-10-2 6-16-7-1z" fill="#6e8592" stroke="#354e63" stroke-width="2"/><path d="m9 16 29-3-1 6-28 4z" fill="#cfb768"/><path d="m16 26 5 0-5 14-6-2z" fill="#a17a50"/><path d="m22 27 8-1-2 7-10 0" fill="none" stroke="#576b71" stroke-width="2"/><path d="m34 14 8 0-2 7-6 0z" fill="#dfe9e9"/>',
  glasses: '<path d="m4 20 14-3 7 4 7-4 13 3-3 16-12 2-6-11-5 11-13-3z" fill="#6d7b83" stroke="#485c70" stroke-width="2"/><path d="m6 22 11-2 4 4-5 10-8-2zM29 24l5-4 9 3-3 10-8 1z" fill="#cbeaf0"/><path d="m9 23 7-1m17 1 6 1" stroke="#fff" stroke-width="3"/>',
  earring: '<path d="M25 7c-13-1-15 15-2 18" fill="none" stroke="#566470" stroke-width="5"/><path d="M25 7c-13-1-15 15-2 18" fill="none" stroke="#e9c972" stroke-width="3"/><path d="m25 22 8 11-8 11-9-11z" fill="#cd8fa3" stroke="#725e74" stroke-width="2"/><path d="m25 24 3 10-5 4-3-6z" fill="#fad3d7"/>',
  belt: '<path d="m5 18 36-4 3 16-37 5z" fill="#9a7c56" stroke="#56616c" stroke-width="2"/><path d="m21 15 13-2 3 19-14 2z" fill="#e7cb76" stroke="#817a5b" stroke-width="2"/><path d="m25 19 6-1 2 10-6 1z" fill="#93866a"/><path d="m9 22 9-1m-8 8 8-1" stroke="#c6a972" stroke-width="2"/>',
  medal: '<path d="m13 4 10 0 7 15-9 10z" fill="#7199bc" stroke="#54778e" stroke-width="2"/><path d="m25 4 10 0-8 22-7-8z" fill="#da858a" stroke="#a9717d" stroke-width="2"/><circle cx="24" cy="31" r="12" fill="#e5bf60" stroke="#937c45" stroke-width="2"/><path d="m24 22 3 6 6 0-5 5 2 5-6-3-6 3 2-6-4-4 6 0z" fill="#fff0a3"/>',
  face: '<path d="m8 21 8-9 17 0 8 9-4 17-14 6-13-7z" fill="#c59280" stroke="#796967" stroke-width="2"/><path d="m11 23 10 3-7 5m24-8-10 3 8 5" fill="#f3c9a4" stroke="#785e5b" stroke-width="2"/><path d="m18 35 12 0" stroke="#88594d" stroke-width="3"/>',
  upload: '<path d="M8 31v9h32v-9M24 32V7m-9 10 9-10 9 10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  camera: '<path d="M5 15h10l4-6h11l4 6h9v25H5z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="24" cy="27" r="8" fill="none" stroke="currentColor" stroke-width="3"/>',
  moon: '<path d="M32 5a19 19 0 1 0 11 28A19 19 0 0 1 32 5Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>',
  pin: '<path d="m17 5 16 2-4 12 8 9-27-3 9-7zM23 27l-3 16" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>'
};

export function GameIcon({ name, className = "" }: { name: string; className?: string }) {
  return <svg className={`game-icon ${className}`} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <g dangerouslySetInnerHTML={{ __html: drawings[name] ?? drawings.medal }} />
  </svg>;
}

// Original MapleStory sprites, pinned to the provider's GMS 83 data.
// These identify the slot visually, not the player's recognized/equipped item.
// Item IDs, source URLs and hashes: public/images/equipment/corsair/sources.json.
const CORSAIR_SLOT_ICONS: Partial<Record<EquipmentSlot, number>> = {
  necklace: 1122000, pendant_2: 1122000, cape: 1102041, earrings: 1032015,
  eye: 1022082, face: 1012106, hat: 1002649, shoes: 1072321,
  gloves: 1082216, overall: 1052134, weapon: 1492013, title: 1142013,
  ring_1: 1112408, ring_2: 1112408, ring_3: 1112408, ring_4: 1112408,
  projectile: 2330005,
};

export function EquipmentIcon({ slot, job, label = "" }: { slot: EquipmentSlot; job: JobId; label?: string }) {
  const itemId = job === "corsair"
    ? CORSAIR_SLOT_ICONS[slot] ?? (/벨트/.test(label) ? 1132004 : undefined)
    : undefined;
  if (itemId !== undefined) {
    // Small local sprites need their original pixels, without image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="game-icon maple-equipment-icon" src={`/images/equipment/corsair/${itemId}.png`}
      width={32} height={32} alt="" aria-hidden="true" draggable={false} />;
  }
  const names: Record<string, string> = {
    necklace: "pendant", pendant_2: "pendant", hat: "hat", cape: "cape", earrings: "earring",
    eye: "glasses", face: "face", shoes: "shoes", gloves: "glove", top: "top", overall: "top",
    bottom: "pants", title: "medal", projectile: "projectile", blessing_1: "leaf", blessing_2: "medal", buff: "potion",
  };
  const name = slot === "weapon" ? (job === "marksman" ? "crossbow" : job === "night_lord" ? "claw" : "weapon")
    : slot.startsWith("ring_") ? "ring" : names[slot] ?? (/벨트/.test(label) ? "belt" : /어깨/.test(label) ? "top" : "medal");
  return <GameIcon name={name} />;
}

export function MapleBackdrop() {
  return <div className="maple-world" aria-hidden="true">
    <div className="maple-cloud cloud-one" /><div className="maple-cloud cloud-two" />
    <div className="maple-cloud cloud-three" /><div className="maple-cloud cloud-four" />
    <div className="maple-tower tower-one" /><div className="maple-tower tower-two" />
    <div className="maple-hill hill-one" /><div className="maple-hill hill-two" /><div className="maple-ground" />
  </div>;
}
