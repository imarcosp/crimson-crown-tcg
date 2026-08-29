import assert from 'node:assert/strict'
import test from 'node:test'

const helperUrl = new URL('./import-image-upload-state.ts', import.meta.url)

async function loadHelpers() {
  const helpers = await import(helperUrl.href).catch(() => null)
  assert.ok(helpers, 'falta el lifecycle real de estado de imagen de importación')
  return helpers
}

test('replacing a local image revokes only the previously owned blob URL', async () => {
  const helpers = await loadHelpers()
  const revoked: string[] = []
  const firstFile = { name: 'first.png' } as File
  const secondFile = { name: 'second.png' } as File
  let nextObjectUrl = 'blob:first'

  const remote = helpers.createImportImageUploadState('https://catalog.example/card.png')
  const first = helpers.replaceImportImageUploadFile(
    remote,
    firstFile,
    () => nextObjectUrl,
    (url: string) => revoked.push(url),
  )
  nextObjectUrl = 'blob:second'
  const second = helpers.replaceImportImageUploadFile(
    first,
    secondFile,
    () => nextObjectUrl,
    (url: string) => revoked.push(url),
  )

  assert.deepEqual(revoked, ['blob:first'])
  assert.equal(second.file, secondFile)
  assert.equal(second.previewUrl, 'blob:second')
  assert.equal(second.ownedObjectUrl, 'blob:second')
})

test('resetting clears the file and revokes an owned blob without revoking remote previews', async () => {
  const helpers = await loadHelpers()
  const revoked: string[] = []
  const file = { name: 'cancelled.webp' } as File
  const remoteUrl = 'https://catalog.example/existing.webp'

  const remote = helpers.createImportImageUploadState(remoteUrl)
  const selected = helpers.replaceImportImageUploadFile(
    remote,
    file,
    () => 'blob:cancelled',
    (url: string) => revoked.push(url),
  )
  const reopened = helpers.resetImportImageUploadState(
    selected,
    remoteUrl,
    (url: string) => revoked.push(url),
  )
  const closed = helpers.resetImportImageUploadState(
    reopened,
    '',
    (url: string) => revoked.push(url),
  )

  assert.deepEqual(revoked, ['blob:cancelled'])
  assert.deepEqual(reopened, {
    file: null,
    previewUrl: remoteUrl,
    ownedObjectUrl: null,
  })
  assert.deepEqual(closed, {
    file: null,
    previewUrl: '',
    ownedObjectUrl: null,
  })
})
