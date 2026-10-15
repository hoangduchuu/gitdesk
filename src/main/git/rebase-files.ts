import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { gitDir } from './status'

const WORK_DIR = 'gitdesk-rebase'

/** Folder inside .git holding GitDesk's rebase todo and reword messages. */
export const rebaseWorkDir = async (repo: string): Promise<string> => join(await gitDir(repo), WORK_DIR)

/** Remove the todo and reword message files once no rebase is using them. */
export async function cleanupRebaseFiles(repo: string): Promise<void> {
  await rm(await rebaseWorkDir(repo), { recursive: true, force: true })
}
