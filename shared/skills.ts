export interface RepositorySkill {
  id: string
  name: string
  title: string
  description: string
  category: string
  directory: string
}

export interface SkillFileEntry {
  path: string
  bytes: number
}

export interface SkillFilePreview {
  id: string
  path: string
  kind: 'markdown' | 'text' | 'image' | 'unavailable'
  content?: string
  reason?: 'size' | 'format'
}
