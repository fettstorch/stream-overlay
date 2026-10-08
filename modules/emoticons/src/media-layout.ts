export function effectTop(height: string) {
  return /^100(?:\.0+)?vh$/i.test(height.trim()) ? "0" : "5vh";
}

export function mediaObjectFit(width: string, height: string) {
  return width.trim() && height.trim() ? "fill" : "contain";
}
