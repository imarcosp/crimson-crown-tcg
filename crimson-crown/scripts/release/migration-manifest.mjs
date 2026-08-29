import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify, TextDecoder } from 'node:util'

const productionProjectRef = 'djfqozfaqkqdoqeoqbzt'
const manifestRelativePath = join('scripts', 'release', 'migration-manifest.json')
const migrationsRelativePath = join('supabase', 'migrations')
const classes = new Set(['remote_applied', 'baseline_present', 'forward_pending'])
const historicalClasses = new Set(['remote_applied', 'baseline_present'])
const proofStatuses = new Set(['candidate', 'verified_present', 'forward_reconciled'])
const sha256Pattern = /^[a-f0-9]{64}$/
const versionPattern = /^\d{8,}$/
const evidenceSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const evidenceAnchorPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const atxHeadingPattern = /^[ ]{0,3}#{1,6}(?:[ \t]+|$)(.*)$/
const simpleHeadingTextPattern = /^[A-Za-z0-9 _-]+$/
const rawHtmlOpeningPattern = /^[ ]{0,3}<([A-Za-z][A-Za-z0-9-]*)(?:[ \t][^<>]*)?>[ \t]*$/
const rawHtmlClosingPattern = /^[ ]{0,3}<\/([A-Za-z][A-Za-z0-9-]*)>[ \t]*$/
const voidHtmlTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/
const markdownDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const execFileAsync = promisify(execFile)
const releaseScriptDir = dirname(fileURLToPath(import.meta.url))
const windowsReparseGuardScript = join(releaseScriptDir, 'query-windows-reparse-points.ps1')

function fail(message) {
  throw new Error(message)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateExactKeys(value, expectedKeys, message = 'campos de manifiesto inválidos') {
  const keys = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()

  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(message)
  }
}

function isWithin(path, parent) {
  const relativePath = relative(parent, path)
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

function isSamePath(left, right) {
  return isWithin(left, right) && isWithin(right, left)
}

function hasSameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function parseEvidenceReference(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.includes('\\') || controlCharacterPattern.test(value)) return null

  const firstHash = value.indexOf('#')
  if (firstHash !== value.lastIndexOf('#')) return null

  const evidencePath = firstHash === -1 ? value : value.slice(0, firstHash)
  const anchor = firstHash === -1 ? null : value.slice(firstHash + 1)
  if (!evidencePath.startsWith('docs/evidence/')) return null
  if (evidencePath.includes('://') || evidencePath.startsWith('/')) return null

  const segments = evidencePath.split('/')
  if (
    segments.length < 3
    || segments.some((segment) => (
      segment.length === 0
      || segment === '.'
      || segment === '..'
      || !evidenceSegmentPattern.test(segment)
    ))
  ) {
    return null
  }

  if (anchor !== null && !evidenceAnchorPattern.test(anchor)) return null
  return { anchor, evidencePath }
}

function validateReleaseProof(releaseProof) {
  if (!isPlainObject(releaseProof)) {
    fail('prueba de release inválida')
  }
  validateExactKeys(
    releaseProof,
    ['status', 'evidence', 'remediationVersions'],
    'prueba de release inválida',
  )

  if (!proofStatuses.has(releaseProof.status)) {
    fail('estado de prueba de release inválido')
  }
  if (!Array.isArray(releaseProof.remediationVersions)) {
    fail('prueba de release inválida')
  }

  if (releaseProof.status === 'candidate') {
    if (releaseProof.evidence !== null || releaseProof.remediationVersions.length !== 0) {
      fail('prueba de release inválida')
    }
    return
  }

  if (!parseEvidenceReference(releaseProof.evidence)) {
    fail('evidencia de release inválida')
  }

  if (releaseProof.status === 'verified_present') {
    if (releaseProof.remediationVersions.length !== 0) {
      fail('prueba de release inválida')
    }
    return
  }

  if (releaseProof.remediationVersions.length === 0) {
    fail('remediaciones de release inválidas')
  }
  const remediationVersions = new Set()
  for (const version of releaseProof.remediationVersions) {
    if (typeof version !== 'string' || !versionPattern.test(version) || remediationVersions.has(version)) {
      fail('remediaciones de release inválidas')
    }
    remediationVersions.add(version)
  }
}

function fenceDescriptor(line) {
  const match = line.match(/^[ ]{0,3}(`{3,}|~{3,})(.*)$/)
  if (!match) return null
  return { character: match[1][0], length: match[1].length, rest: match[2] }
}

function githubStyleHeadingSlug(headingText) {
  if (!simpleHeadingTextPattern.test(headingText)) return null
  return headingText.trim().toLowerCase().replace(/ +/g, '-') || null
}

function opaqueHtmlBlockDescriptor(line) {
  const content = line.replace(/^[ ]{0,3}/, '')
  const forms = [
    { opening: '<?', closing: '?>' },
    { opening: '<![CDATA[', closing: ']]>' },
  ]
  if (/^<![A-Z]/.test(content)) forms.push({ opening: '<!', closing: '>' })

  const form = forms.find(({ opening }) => content.startsWith(opening))
  if (!form) return null
  return {
    closed: content.slice(form.opening.length).includes(form.closing),
    closing: form.closing,
  }
}

function collectMarkdownAnchors(markdown) {
  const anchors = new Set()
  let openFence = null
  let openHtmlComment = false
  let opaqueHtmlEnd = null
  let rawHtmlBlock = null

  for (const line of markdown.split(/\r\n|\n|\r/)) {
    const fence = fenceDescriptor(line)
    if (openFence) {
      if (
        fence
        && fence.character === openFence.character
        && fence.length >= openFence.length
        && fence.rest.trim() === ''
      ) {
        openFence = null
      }
      continue
    }
    if (fence) {
      openFence = fence
      continue
    }

    if (openHtmlComment) {
      if (line.includes('-->')) openHtmlComment = false
      continue
    }
    const htmlCommentStart = line.indexOf('<!--')
    if (htmlCommentStart !== -1) {
      if (line.indexOf('-->', htmlCommentStart + 4) === -1) openHtmlComment = true
      continue
    }

    if (opaqueHtmlEnd) {
      if (line.includes(opaqueHtmlEnd)) opaqueHtmlEnd = null
      continue
    }
    const opaqueHtmlBlock = opaqueHtmlBlockDescriptor(line)
    if (opaqueHtmlBlock) {
      if (!opaqueHtmlBlock.closed) opaqueHtmlEnd = opaqueHtmlBlock.closing
      continue
    }

    const rawHtmlOpening = line.match(rawHtmlOpeningPattern)
    const rawHtmlClosing = line.match(rawHtmlClosingPattern)
    if (rawHtmlBlock) {
      if (rawHtmlOpening?.[1].toLowerCase() === rawHtmlBlock.tag) rawHtmlBlock.depth += 1
      if (rawHtmlClosing?.[1].toLowerCase() === rawHtmlBlock.tag) rawHtmlBlock.depth -= 1
      if (rawHtmlBlock.depth === 0) rawHtmlBlock = null
      continue
    }
    if (rawHtmlOpening) {
      const tag = rawHtmlOpening[1].toLowerCase()
      if (!voidHtmlTags.has(tag) && !line.trimEnd().endsWith('/>')) {
        rawHtmlBlock = { depth: 1, tag }
      }
      continue
    }
    if (rawHtmlClosing) continue

    const atxHeading = line.match(atxHeadingPattern)
    if (!atxHeading) continue
    const headingText = atxHeading[1].replace(/[ \t]+#+[ \t]*$/, '').trim()
    const baseSlug = githubStyleHeadingSlug(headingText)
    if (!baseSlug) continue

    let headingSlug = baseSlug
    let suffix = 0
    while (anchors.has(headingSlug)) {
      suffix += 1
      headingSlug = `${baseSlug}-${suffix}`
    }
    anchors.add(headingSlug)
  }

  return anchors
}

async function assertNoWindowsReparsePoints(paths) {
  if (process.platform !== 'win32') return
  const systemRoot = process.env.SystemRoot
  if (typeof systemRoot !== 'string' || !isAbsolute(systemRoot)) {
    fail('evidencia de release inválida')
  }

  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const { stdout, stderr } = await execFileAsync(
    powershell,
    ['-NoProfile', '-NonInteractive', '-File', windowsReparseGuardScript, ...paths],
    { encoding: 'utf8', maxBuffer: 16 * 1024, timeout: 15_000, windowsHide: true },
  )
  if (stdout !== 'SAFE' || stderr !== '') fail('evidencia de release inválida')
}

async function readNonReparseEvidenceFileIdentity(path) {
  const absolutePath = resolve(path)
  const { root } = parse(absolutePath)
  const components = relative(root, absolutePath).split(sep).filter(Boolean)
  const componentPaths = []
  let componentPath = root
  for (const component of components) {
    componentPath = join(componentPath, component)
    componentPaths.push(componentPath)
  }
  await assertNoWindowsReparsePoints(componentPaths)

  let currentPath = root
  let currentIdentity = null

  for (let index = 0; index < components.length; index += 1) {
    currentPath = join(currentPath, components[index])
    currentIdentity = await lstat(currentPath, { bigint: true })
    const isFinalComponent = index === components.length - 1
    if (
      currentIdentity.isSymbolicLink()
      || (isFinalComponent ? !currentIdentity.isFile() : !currentIdentity.isDirectory())
    ) {
      fail('evidencia de release inválida')
    }
  }

  if (!currentIdentity) fail('evidencia de release inválida')
  return currentIdentity
}

async function validatePhysicalEvidenceReference({ evidence, rootDir }) {
  const reference = parseEvidenceReference(evidence)
  if (!reference) fail('evidencia de release inválida')

  const absoluteRoot = resolve(rootDir)
  const evidenceRoot = join(absoluteRoot, 'docs', 'evidence')
  const evidenceSegments = reference.evidencePath.split('/')
  const absoluteEvidenceFile = join(absoluteRoot, ...evidenceSegments)
  const lexicalIdentity = await readNonReparseEvidenceFileIdentity(absoluteEvidenceFile)
  const physicalRoot = await realpath(absoluteRoot)
  const physicalEvidenceRoot = await realpath(evidenceRoot)
  const physicalEvidenceFile = await realpath(absoluteEvidenceFile)
  const physicalIdentity = await stat(physicalEvidenceFile, { bigint: true })
  const expectedPhysicalEvidenceRoot = join(physicalRoot, 'docs', 'evidence')
  const expectedPhysicalEvidenceFile = join(physicalRoot, ...evidenceSegments)

  if (
    !physicalIdentity.isFile()
    || lexicalIdentity.nlink !== 1n
    || physicalIdentity.nlink !== 1n
    || !hasSameIdentity(lexicalIdentity, physicalIdentity)
    || !isSamePath(physicalEvidenceRoot, expectedPhysicalEvidenceRoot)
    || !isWithin(physicalEvidenceFile, physicalEvidenceRoot)
    || !isSamePath(physicalEvidenceFile, expectedPhysicalEvidenceFile)
  ) {
    fail('evidencia de release inválida')
  }

  if (reference.anchor !== null) {
    const markdown = markdownDecoder.decode(await readFile(physicalEvidenceFile))
    if (!collectMarkdownAnchors(markdown).has(reference.anchor)) {
      fail('evidencia de release inválida')
    }
  }
}

async function validateEvidenceReferences({ entries, rootDir }) {
  const validatedEvidence = new Set()
  try {
    for (const entry of entries) {
      if (!historicalClasses.has(entry.class) || entry.releaseProof.status === 'candidate') continue
      const evidence = entry.releaseProof.evidence
      if (validatedEvidence.has(evidence)) continue
      await validatePhysicalEvidenceReference({ evidence, rootDir })
      validatedEvidence.add(evidence)
    }
  } catch {
    fail('evidencia de release inválida')
  }
}

function validateEntry(entry, { files, versions, classifiedFiles }) {
  if (!isPlainObject(entry) || !classes.has(entry.class)) {
    fail('clase de migración inválida')
  }

  const isRemoteApplied = entry.class === 'remote_applied'
  const isHistorical = historicalClasses.has(entry.class)
  validateExactKeys(
    entry,
    isRemoteApplied
      ? ['class', 'version', 'remoteName', 'file', 'sha256', 'releaseProof']
      : isHistorical
        ? ['class', 'version', 'file', 'sha256', 'releaseProof']
        : ['class', 'version', 'file', 'sha256'],
  )

  if (typeof entry.version !== 'string' || !versionPattern.test(entry.version)) {
    fail('versión de migración inválida')
  }
  if (versions.has(entry.version)) {
    fail('versión de migración duplicada')
  }
  versions.add(entry.version)

  if (typeof entry.file !== 'string' || !entry.file.endsWith('.sql') || entry.file.includes('/') || entry.file.includes('\\')) {
    fail('archivo de migración inválido')
  }
  if (classifiedFiles.has(entry.file)) {
    fail('archivo asignado a más de una clase')
  }
  classifiedFiles.add(entry.file)
  if (!files.has(entry.file)) {
    fail('archivo de migración desconocido')
  }

  if (typeof entry.sha256 !== 'string' || !sha256Pattern.test(entry.sha256)) {
    fail('hash SHA-256 inválido')
  }

  if (!isRemoteApplied) {
    const separatorIndex = entry.file.indexOf('_')
    const fileVersion = separatorIndex > 0 ? entry.file.slice(0, separatorIndex) : null
    if (entry.version !== fileVersion) {
      fail('versión de migración no coincide con el archivo')
    }
  }

  if (isRemoteApplied && (typeof entry.remoteName !== 'string' || entry.remoteName.length === 0)) {
    fail('nombre remoto inválido')
  }
  if (isHistorical) {
    validateReleaseProof(entry.releaseProof)
  }
}

function validateCrossEntryRelationships(entries) {
  const historicalEntries = entries.filter((entry) => historicalClasses.has(entry.class))
  const forwardEntries = entries.filter((entry) => entry.class === 'forward_pending')
  const forwardByVersion = new Map(forwardEntries.map((entry) => [entry.version, entry]))
  const excludedFrontier = historicalEntries.reduce((frontier, entry) => {
    const version = BigInt(entry.version)
    return frontier === null || version > frontier ? version : frontier
  }, null)

  for (const entry of historicalEntries) {
    if (entry.releaseProof.status !== 'forward_reconciled') continue

    const excludedVersion = BigInt(entry.version)
    for (const remediationVersion of entry.releaseProof.remediationVersions) {
      const remediation = forwardByVersion.get(remediationVersion)
      const numericRemediationVersion = BigInt(remediationVersion)
      if (
        !remediation
        || numericRemediationVersion <= excludedVersion
        || (excludedFrontier !== null && numericRemediationVersion <= excludedFrontier)
      ) {
        fail('remediaciones de release inválidas')
      }
    }
  }

  let previousForwardVersion = null
  for (const entry of forwardEntries) {
    const version = BigInt(entry.version)
    if (excludedFrontier !== null && version <= excludedFrontier) {
      fail('versión forward no posterior al frontier')
    }
    if (previousForwardVersion !== null && version <= previousForwardVersion) {
      fail('orden de migraciones forward inválido')
    }
    previousForwardVersion = version
  }
}

function freezeManifestSnapshot(manifest) {
  for (const entry of manifest.entries) {
    if (historicalClasses.has(entry.class)) {
      Object.freeze(entry.releaseProof.remediationVersions)
      Object.freeze(entry.releaseProof)
    }
    Object.freeze(entry)
  }
  Object.freeze(manifest.entries)
  return Object.freeze(manifest)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function getMigrationManifestPaths({ rootDir }) {
  const absoluteRoot = resolve(rootDir)

  return {
    rootDir: absoluteRoot,
    manifestPath: join(absoluteRoot, manifestRelativePath),
    migrationsPath: join(absoluteRoot, migrationsRelativePath),
  }
}

export async function loadAndValidateManifest({ rootDir, allowCandidates }) {
  const { manifestPath, migrationsPath } = getMigrationManifestPaths({ rootDir })
  let manifest

  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    fail('no se pudo leer el manifiesto de migraciones')
  }

  if (!isPlainObject(manifest) || Object.keys(manifest).sort().join(',') !== 'entries,productionProjectRef,schemaVersion') {
    fail('forma de manifiesto inválida')
  }
  if (manifest.schemaVersion !== 2) {
    fail('versión de esquema de manifiesto no admitida')
  }
  if (manifest.productionProjectRef !== productionProjectRef) {
    fail('referencia de proyecto de producción no permitida')
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    fail('entradas de manifiesto inválidas')
  }

  let migrationFiles
  try {
    migrationFiles = await readdir(migrationsPath)
  } catch {
    fail('no se pudo leer el directorio de migraciones')
  }
  const files = new Set(migrationFiles.filter((file) => file.endsWith('.sql')))
  const versions = new Set()
  const classifiedFiles = new Set()

  for (const entry of manifest.entries) {
    validateEntry(entry, { files, versions, classifiedFiles })
  }

  for (const file of files) {
    if (!classifiedFiles.has(file)) {
      fail('migración sin clasificar')
    }
  }

  validateCrossEntryRelationships(manifest.entries)
  await validateEvidenceReferences({ entries: manifest.entries, rootDir })

  if (
    allowCandidates !== true
    && manifest.entries.some((entry) => (
      historicalClasses.has(entry.class) && entry.releaseProof.status === 'candidate'
    ))
  ) {
    fail('prueba de release candidata')
  }

  for (const entry of manifest.entries) {
    let migrationBytes
    try {
      migrationBytes = await readFile(join(migrationsPath, entry.file))
    } catch {
      fail('hash SHA-256 no disponible')
    }
    const actualHash = sha256(migrationBytes)
    if (entry.sha256 !== actualHash) {
      fail('hash SHA-256 no coincide')
    }
  }

  return freezeManifestSnapshot(manifest)
}
