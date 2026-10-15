/** The parts of material-icon-theme's manifest (dist/material-icons.json) used to pick icons. */
export interface IconManifest {
  iconDefinitions: Record<string, { iconPath: string }>
  fileExtensions: Record<string, string>
  fileNames: Record<string, string>
  folderNames: Record<string, string>
  folderNamesExpanded: Record<string, string>
  file: string
  folder: string
  folderExpanded: string
}

/** Icon file name (without .svg) for an icon id, e.g. "react_ts" from "./../icons/react_ts.svg". */
const iconFile = (manifest: IconManifest, id: string): string => {
  const path = manifest.iconDefinitions[id]?.iconPath ?? `${id}.svg`
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.svg$/, '')
}

/**
 * Icon for a file, as VS Code's Material Icon Theme picks it: exact file name first, then the
 * longest matching extension ("utils.test.ts" tries "test.ts" before "ts"), then a plain file.
 */
export function fileIconName(manifest: IconManifest, path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const byName = manifest.fileNames[name]
  if (byName) return iconFile(manifest, byName)
  const parts = name.split('.')
  for (let i = 1; i < parts.length; i++) {
    const byExtension = manifest.fileExtensions[parts.slice(i).join('.')]
    if (byExtension) return iconFile(manifest, byExtension)
  }
  return iconFile(manifest, manifest.file)
}

/** Icon for a folder by its (last) name, e.g. "src" or "shared/database" -> database. */
export function folderIconName(manifest: IconManifest, name: string, open: boolean): string {
  const last = name.slice(name.lastIndexOf('/') + 1).toLowerCase()
  const named = (open ? manifest.folderNamesExpanded : manifest.folderNames)[last]
  return iconFile(manifest, named ?? (open ? manifest.folderExpanded : manifest.folder))
}
