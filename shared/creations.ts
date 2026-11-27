export type CreationMediaKind = 'image' | 'video' | 'audio' | 'document';
export type CreationBodyFormat = 'text' | 'markdown';
export const MAX_CREATION_BODY = 50_000;

export interface CreationMedia {
  kind: CreationMediaKind;
  name: string;
  url: string;
  markdownPath?: string;
}

export interface CreationUpload {
  id: string;
  name: string;
  kind: 'image' | 'video';
  size: number;
  url: string;
}

export interface Creation {
  id: string;
  title: string;
  body: string;
  bodyFormat?: CreationBodyFormat;
  categoryId: string | null;
  isCover: boolean;
  addedAt: string;
  media: CreationMedia[];
}

export interface CreationCategory {
  id: string;
  name: string;
}

export interface CreationLibrary {
  creations: Creation[];
  categories: CreationCategory[];
}
