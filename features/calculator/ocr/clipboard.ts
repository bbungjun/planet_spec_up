/** Read image files only; ordinary text pastes keep their native behavior. */
export function clipboardImages(clipboard: DataTransfer | null): File[] {
  if (!clipboard) return [];
  const images = Array.from(clipboard.items ?? []).flatMap(item => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file?.type.toLowerCase().startsWith("image/") ? [file] : [];
  });
  return images.length ? images : Array.from(clipboard.files ?? [])
    .filter(file => file.type.toLowerCase().startsWith("image/"));
}
