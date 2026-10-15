import manifest from 'material-icon-theme/dist/material-icons.json'
import { fileIconName, folderIconName, type IconManifest } from '../../../shared/file-icons'

const icons = manifest as unknown as IconManifest

/** Icons are copied next to index.html at build time (see electron.vite.config.ts). */
const iconUrl = (name: string): string => new URL(`${name}.svg`, document.baseURI).href

export function FileIcon({ path }: { path: string }) {
  return <img className="type-icon" src={iconUrl(fileIconName(icons, path))} alt="" width={16} height={16} draggable={false} />
}

export function FolderIcon({ name, open }: { name: string; open: boolean }) {
  return (
    <img className="type-icon" src={iconUrl(folderIconName(icons, name, open))} alt="" width={16} height={16} draggable={false} />
  )
}
