import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Profile, ProfileInput } from '../shared/model'

interface Settings {
  profiles: Profile[]
  /** Repository path -> profile id. */
  repoProfiles: Record<string, string>
}

const EMPTY: Settings = { profiles: [], repoProfiles: {} }
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const EMAIL = /^[^\s@<>]+@[^\s@<>]+$/

const validate = (input: ProfileInput): Omit<Profile, 'id'> => {
  const name = input.name.trim()
  const email = input.email.trim()
  if (name === '' || CONTROL_CHARS.test(name) || /[<>]/.test(name)) throw new Error('Invalid profile name')
  if (!EMAIL.test(email) || CONTROL_CHARS.test(email)) throw new Error('Invalid profile email')
  return { name, email }
}

const isProfile = (value: unknown): value is Profile => {
  const p = value as Partial<Profile> | null
  return !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.email === 'string'
}

/** Commit identities and each repository's chosen one, kept in a JSON file in the app's data folder. */
export class ProfileStore {
  constructor(private readonly file: string) {}

  private async read(): Promise<Settings> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch {
      return EMPTY
    }
    try {
      const parsed = JSON.parse(text) as Partial<Settings>
      const profiles = Array.isArray(parsed.profiles) ? parsed.profiles.filter(isProfile) : []
      const repoProfiles =
        parsed.repoProfiles && typeof parsed.repoProfiles === 'object' ? { ...parsed.repoProfiles } : {}
      return { profiles, repoProfiles }
    } catch (error) {
      // Keep the unreadable file for the user instead of silently overwriting it.
      console.error('[gitdesk] profiles file is not valid JSON; moving it aside', error)
      await rename(this.file, `${this.file}.corrupt-${Date.now()}`).catch(() => undefined)
      return EMPTY
    }
  }

  private async write(settings: Settings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temp = `${this.file}.tmp`
    await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    await rename(temp, this.file)
  }

  async list(): Promise<Profile[]> {
    return (await this.read()).profiles
  }

  async save(input: ProfileInput): Promise<Profile> {
    const fields = validate(input)
    const settings = await this.read()
    if (input.id !== undefined && !settings.profiles.some((p) => p.id === input.id)) {
      throw new Error('Profile not found')
    }
    const profile: Profile = { id: input.id ?? randomUUID(), ...fields }
    const profiles =
      input.id === undefined
        ? [...settings.profiles, profile]
        : settings.profiles.map((p) => (p.id === input.id ? profile : p))
    await this.write({ ...settings, profiles })
    return profile
  }

  async remove(id: string): Promise<void> {
    const settings = await this.read()
    const repoProfiles = Object.fromEntries(Object.entries(settings.repoProfiles).filter(([, value]) => value !== id))
    await this.write({ profiles: settings.profiles.filter((p) => p.id !== id), repoProfiles })
  }

  async repoProfile(repo: string): Promise<Profile | null> {
    const settings = await this.read()
    const id = settings.repoProfiles[repo]
    return settings.profiles.find((p) => p.id === id) ?? null
  }

  async setRepoProfile(repo: string, id: string | null): Promise<void> {
    const settings = await this.read()
    if (id !== null && !settings.profiles.some((p) => p.id === id)) throw new Error('Profile not found')
    const { [repo]: _previous, ...others } = settings.repoProfiles
    await this.write({ ...settings, repoProfiles: id === null ? others : { ...others, [repo]: id } })
  }
}
