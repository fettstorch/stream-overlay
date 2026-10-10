// jsdom has no layout engine. CodeMirror needs these Range APIs for its
// asynchronous selection measurements; keep the shim confined to tests.
if (!Range.prototype.getClientRects)
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
if (!Range.prototype.getBoundingClientRect)
  Range.prototype.getBoundingClientRect = () => new DOMRect();
