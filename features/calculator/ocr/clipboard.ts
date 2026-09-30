/**
 * 붙여넣기에서 이미지 File만 추출하는 입력 어댑터.
 * 일반 텍스트 붙여넣기의 기본 동작은 이 모듈에서 차단하지 않는다.
 */
/**
 * 클립보드 items의 이미지 파일을 우선 읽고, 없으면 files 목록을 확인한다.
 * 이미지 형식·용량의 세부 허용 여부는 뒤의 인식 경로에서 검사한다.
 */
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
