export type ImportImageUploadState = Readonly<{
  file: File | null
  previewUrl: string
  ownedObjectUrl: string | null
}>

type CreateObjectUrl = (file: File) => string
type RevokeObjectUrl = (url: string) => void

export function createImportImageUploadState(previewUrl = ''): ImportImageUploadState {
  return Object.freeze({
    file: null,
    previewUrl,
    ownedObjectUrl: null,
  })
}

function revokeOwnedObjectUrl(state: ImportImageUploadState, revokeObjectUrl: RevokeObjectUrl) {
  if (state.ownedObjectUrl) revokeObjectUrl(state.ownedObjectUrl)
}

export function replaceImportImageUploadFile(
  state: ImportImageUploadState,
  file: File,
  createObjectUrl: CreateObjectUrl,
  revokeObjectUrl: RevokeObjectUrl,
): ImportImageUploadState {
  const ownedObjectUrl = createObjectUrl(file)
  revokeOwnedObjectUrl(state, revokeObjectUrl)
  return Object.freeze({ file, previewUrl: ownedObjectUrl, ownedObjectUrl })
}

export function resetImportImageUploadState(
  state: ImportImageUploadState,
  previewUrl: string,
  revokeObjectUrl: RevokeObjectUrl,
): ImportImageUploadState {
  revokeOwnedObjectUrl(state, revokeObjectUrl)
  return createImportImageUploadState(previewUrl)
}
